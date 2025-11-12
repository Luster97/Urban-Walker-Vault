// index.js
import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import bodyParser from 'body-parser';
import process from 'process';

// Ensure fetch is available
let _fetch = globalThis.fetch;
if (typeof _fetch !== 'function') {
  try {
    const mf = await import('node-fetch');
    _fetch = mf.default;
  } catch {
    console.warn('Global fetch not available; reCAPTCHA may fail.');
  }
}

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
if (!process.env.JWT_SECRET) console.warn('⚠ Using default JWT secret — set JWT_SECRET in production.');

app.use(cors());
app.use(bodyParser.json());

/* ---------------------------
   AUTH HELPERS
--------------------------- */
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    const token = auth.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

/* ---------------------------
   DATABASE INITIALIZATION
--------------------------- */
let db;

(async () => {
  try {
    const DB_FILE = process.env.DB_FILE || './uwv.db';
    db = await open({ filename: DB_FILE, driver: sqlite3.Database });

    // SCHEMA
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sneakers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image TEXT,
        price REAL,
        desc TEXT,
        qty INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        item TEXT,
        price REAL,
        date TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS contact_info (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email TEXT,
        phone TEXT,
        address TEXT,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        brand TEXT,
        size TEXT,
        price REAL,
        stock INTEGER DEFAULT 0,
        image_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'staff',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed contact + admin
    const contact = await db.get('SELECT * FROM contact_info WHERE id = 1');
    if (!contact) {
      await db.run(
        'INSERT INTO contact_info (id, email, phone, address, description) VALUES (1, ?, ?, ?, ?)',
        ['info@uwv.com', '+1 555-123-4567', '123 Sneaker St, Urban City', 'Contact us for sneaker inquiries.']
      );
    }

    const adminExists = await db.get('SELECT * FROM users WHERE email = ?', ['admin@uwv.com']);
    if (!adminExists) {
      const hash = bcrypt.hashSync('admin123', 10);
      await db.run(
        'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
        ['admin', 'admin@uwv.com', hash, 'admin']
      );
      console.log(' Default admin created: admin@uwv.com / admin123');
    }

    console.log(' Database initialized.');
  } catch (err) {
    console.error(' DB initialization failed:', err);
    process.exit(1);
  }
})();

/* ---------------------------
   AUTH ROUTES
--------------------------- */
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role)
    return res.status(400).json({ error: 'All fields required' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    await db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [
      username,
      email,
      hash,
      role
    ]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'User already exists or invalid data' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '1d'
  });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

/* ---------------------------
   USER ROUTES
--------------------------- */
app.get('/api/contact', async (req, res) => {
  res.json(await db.get('SELECT * FROM contact_info WHERE id = 1'));
});

app.put('/api/contact', verifyToken, requireAdmin, async (req, res) => {
  const { email, phone, address, description } = req.body;
  await db.run('UPDATE contact_info SET email=?, phone=?, address=?, description=? WHERE id=1', [
    email,
    phone,
    address,
    description
  ]);
  res.json({ success: true });
});

app.get('/api/sneakers', async (req, res) => {
  res.json(await db.all('SELECT * FROM sneakers'));
});

app.post('/api/checkout', async (req, res) => {
  const { user_id, cart } = req.body;
  if (!user_id || !Array.isArray(cart) || !cart.length)
    return res.status(400).json({ error: 'Missing cart data' });

  const now = new Date().toISOString();
  for (const item of cart) {
    await db.run('INSERT INTO purchases (user_id, item, price, date) VALUES (?, ?, ?, ?)', [
      user_id,
      item.name,
      item.price,
      now
    ]);
  }
  res.json({ success: true });
});

app.get('/api/purchase/:user_id', async (req, res) => {
  const { user_id } = req.params;
  res.json(await db.all('SELECT * FROM purchases WHERE user_id = ?', [user_id]));
});

/* ---------------------------
   ADMIN ROUTES
--------------------------- */

//  Admin Inventory
app.get('/api/admin/inventory', verifyToken, requireAdmin, async (req, res) => {
  res.json(await db.all('SELECT * FROM admin_inventory ORDER BY created_at DESC'));
});

app.post('/api/admin/inventory', verifyToken, requireAdmin, async (req, res) => {
  const { name, brand, size, price, stock, image_url } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Missing name or price' });
  const result = await db.run(
    'INSERT INTO admin_inventory (name, brand, size, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)',
    [name, brand, size, price, stock || 0, image_url || '']
  );
  res.json({ success: true, id: result.lastID });
});

app.put('/api/admin/inventory/:id', verifyToken, requireAdmin, async (req, res) => {
  const { name, brand, size, price, stock, image_url } = req.body;
  await db.run(
    'UPDATE admin_inventory SET name=?, brand=?, size=?, price=?, stock=?, image_url=? WHERE id=?',
    [name, brand, size, price, stock, image_url, req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/admin/inventory/:id', verifyToken, requireAdmin, async (req, res) => {
  await db.run('DELETE FROM admin_inventory WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// 👥 Admin Staff Management
app.get('/api/admin/staff', verifyToken, requireAdmin, async (req, res) => {
  res.json(await db.all('SELECT id, name, email, role, created_at FROM admin_staff'));
});

app.post('/api/admin/staff', verifyToken, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    await db.run('INSERT INTO admin_staff (name, email, password, role) VALUES (?, ?, ?, ?)', [
      name,
      email,
      hash,
      role || 'staff'
    ]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Staff member already exists or invalid data' });
  }
});

app.delete('/api/admin/staff/:id', verifyToken, requireAdmin, async (req, res) => {
  await db.run('DELETE FROM admin_staff WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(` Server running at http://localhost:${PORT}`));
