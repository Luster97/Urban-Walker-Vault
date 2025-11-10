// ...checkout route will be defined later after app/db initialization
import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import bodyParser from 'body-parser';
import process from 'process';

// Ensure fetch is available in Node (Node 18+ has global fetch). If not, try to polyfill.
let _fetch = globalThis.fetch;
if (typeof _fetch !== 'function') {
  try {
    const mf = await import('node-fetch');
    _fetch = mf.default;
  } catch (e) {
    console.warn('Global fetch not available and node-fetch could not be imported. reCAPTCHA verification may fail.');
  }
}

const app = express();
const PORT = 3001;

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret'; // Use env in production
if (!process.env.JWT_SECRET) console.warn('WARNING: Using default JWT secret. Set JWT_SECRET env var in production.');

app.use(cors());
app.use(bodyParser.json());

// Simple auth middleware that verifies Bearer JWT and attaches payload to req.user
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

let db;

// Initialize SQLite DB
(async () => {
  try {
    const DB_FILE = process.env.DB_FILE || './uwv.db';
    console.log('Using DB file:', DB_FILE);

    async function initSchema(database) {
      await database.exec(`CREATE TABLE IF NOT EXISTS sneakers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image TEXT,
        price REAL,
        desc TEXT,
        qty INTEGER DEFAULT 0
      )`);
      await database.exec(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
      )`);
      await database.exec(`CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        item TEXT,
        price REAL,
        date TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`);
      await database.exec(`CREATE TABLE IF NOT EXISTS contact_info (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email TEXT,
        phone TEXT,
        address TEXT,
        description TEXT
      )`);
      // Insert default contact info if not exists
      const contact = await database.get('SELECT * FROM contact_info WHERE id = 1');
      if (!contact) {
        await database.run('INSERT INTO contact_info (id, email, phone, address, description) VALUES (1, ?, ?, ?, ?)', [
          'info@uwv.com',
          '+1 555-123-4567',
          '123 Sneaker St, Urban City',
          'Contact us for sneaker inquiries, support, or business partnerships.'
        ]);
      }
      // Create default admin if not exists
      const adminEmail = 'admin@uwv.com';
      const adminExists = await database.get('SELECT * FROM users WHERE email = ?', [adminEmail]);
      if (!adminExists) {
        const hash = bcrypt.hashSync('admin123', 10);
        await database.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [
          'admin',
          adminEmail,
          hash,
          'admin'
        ]);
        console.log('Default admin created: admin@uwv.com / admin123');
      }
    }

    try {
      db = await open({ filename: DB_FILE, driver: sqlite3.Database });
      await initSchema(db);
    } catch (diskErr) {
      console.warn('Disk DB initialization failed; attempting in-memory DB. Error:', diskErr && diskErr.message);
      try {
        db = await open({ filename: ':memory:', driver: sqlite3.Database });
        console.log('Using in-memory SQLite database as fallback. Data will not persist to disk.');
        await initSchema(db);
      } catch (memErr) {
        throw memErr; // will be caught by outer catch
      }
    }

    // Get contact info (route depends on db now)
    app.get('/api/contact', async (req, res) => {
      const info = await db.get('SELECT * FROM contact_info WHERE id = 1');
      res.json(info);
    });

    // Update contact info (admin only, no auth for demo)
    app.put('/api/contact', async (req, res) => {
      const { email, phone, address, description } = req.body;
      await db.run('UPDATE contact_info SET email = ?, phone = ?, address = ?, description = ? WHERE id = 1', [email, phone, address, description]);
      res.json({ success: true });
    });
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
})();

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { username, email, password, role, recaptchaToken } = req.body;
  if (!username || !email || !password || !role) return res.status(400).json({ error: 'All fields required' });

  // If a reCAPTCHA secret is configured, verify the token
  const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
  if (RECAPTCHA_SECRET) {
    if (!recaptchaToken) return res.status(400).json({ error: 'reCAPTCHA token missing' });
    try {
      const params = new URLSearchParams();
      params.append('secret', RECAPTCHA_SECRET);
      params.append('response', recaptchaToken);
      const verifyRes = await _fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const verifyJson = await verifyRes.json();
      // verifyJson: { success: boolean, score?: number, action?: string, ... }
      if (!verifyJson.success) {
        return res.status(400).json({ error: 'reCAPTCHA verification failed' });
      }
      // If using v3, reject low-score attempts (adjust threshold as desired)
      if (typeof verifyJson.score === 'number' && verifyJson.score < 0.3) {
        return res.status(400).json({ error: 'reCAPTCHA score too low' });
      }
    } catch (err) {
      console.error('reCAPTCHA verification error', err);
      return res.status(500).json({ error: 'reCAPTCHA verification error' });
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    await db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [username, email, hash, role]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'User already exists or invalid data' });
  }
});

// --- Auth helpers (optional usage) ---
function verifyToken(req, res, next) {
  const auth = req.headers && req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No authorization header' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid authorization format' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

// Admin-protected routes (optional, non-breaking: existing /api/sneakers remains open)
app.post('/api/admin/sneakers', verifyToken, requireAdmin, async (req, res) => {
  const { name, image, price, desc, qty } = req.body;
  if (!name || !image || !price || !desc) return res.status(400).json({ error: 'All fields required' });
  const result = await db.run(
    'INSERT INTO sneakers (name, image, price, desc, qty) VALUES (?, ?, ?, ?, ?)',
    [name, image, price, desc, qty || 0]
  );
  res.json({ success: true, id: result.lastID });
});

app.put('/api/admin/sneakers/:id', verifyToken, requireAdmin, async (req, res) => {
  const { name, image, price, desc, qty } = req.body;
  await db.run('UPDATE sneakers SET name = ?, image = ?, price = ?, desc = ?, qty = ? WHERE id = ?', [name, image, price, desc, qty, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/sneakers/:id', verifyToken, requireAdmin, async (req, res) => {
  await db.run('DELETE FROM sneakers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Protect contact update behind admin token if provided
app.put('/api/admin/contact', verifyToken, requireAdmin, async (req, res) => {
  const { email, phone, address, description } = req.body;
  await db.run('UPDATE contact_info SET email = ?, phone = ?, address = ?, description = ? WHERE id = 1', [email, phone, address, description]);
  res.json({ success: true });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

// Add purchase endpoint
app.post('/api/purchase', async (req, res) => {
  const { user_id, item, price } = req.body;
  if (!user_id || !item || !price) return res.status(400).json({ error: 'All fields required' });
  await db.run('INSERT INTO purchases (user_id, item, price, date) VALUES (?, ?, ?, ?)', [user_id, item, price, new Date().toISOString()]);
  res.json({ success: true });
});

// Real checkout endpoint: accepts cart array
app.post('/api/checkout', async (req, res) => {
  const { user_id, cart } = req.body;
  if (!user_id || !Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'Missing user or cart' });
  const now = new Date().toISOString();
  for (const item of cart) {
    await db.run('INSERT INTO purchases (user_id, item, price, date) VALUES (?, ?, ?, ?)', [user_id, item.name, item.price, now]);
  }
  res.json({ success: true });
});

// Get purchase history for a user
app.get('/api/purchase/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const purchases = await db.all('SELECT * FROM purchases WHERE user_id = ?', [user_id]);
  res.json(purchases);
});

// Get all purchases with user info (admin view)
app.get('/api/purchase', async (req, res) => {
  const purchases = await db.all(`
    SELECT purchases.*, users.username, users.email
    FROM purchases
    JOIN users ON purchases.user_id = users.id
    ORDER BY purchases.date DESC
  `);
  res.json(purchases);
});

// Get all sneakers
app.get('/api/sneakers', async (req, res) => {
  const sneakers = await db.all('SELECT * FROM sneakers');
  res.json(sneakers);
});

// Update sneaker
app.put('/api/sneakers/:id', async (req, res) => {
  const { name, image, price, desc, qty } = req.body;
  await db.run(
    'UPDATE sneakers SET name = ?, image = ?, price = ?, desc = ?, qty = ? WHERE id = ?',
    [name, image, price, desc, qty, req.params.id]
  );
  res.json({ success: true });
});

// Delete sneaker
app.delete('/api/sneakers/:id', async (req, res) => {
  await db.run('DELETE FROM sneakers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Add sneaker (admin)
app.post('/api/sneakers', async (req, res) => {
  const { name, image, price, desc, qty } = req.body;
  if (!name || !image || !price || !desc) return res.status(400).json({ error: 'All fields required' });
  const result = await db.run(
    'INSERT INTO sneakers (name, image, price, desc, qty) VALUES (?, ?, ?, ?, ?)',
    [name, image, price, desc, qty || 0]
  );
  res.json({ success: true, id: result.lastID });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
