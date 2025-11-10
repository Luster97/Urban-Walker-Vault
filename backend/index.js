// index.js — updated to match frontend expectations (adds missing /api/stats endpoints)

import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// ---------------------------------------------------------
//  SQLite Setup
// ---------------------------------------------------------
sqlite3.verbose();
const db = new sqlite3.Database('./uwv.db', (err) => {
  if (err) console.error("SQLite error:", err);
  else console.log("SQLite connected (uwv.db)");
});

// Create required tables
db.run(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  email TEXT UNIQUE,
  password TEXT,
  role TEXT
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fullName TEXT,
  email TEXT UNIQUE,
  role TEXT,
  password TEXT
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS sneakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  image TEXT,
  price REAL,
  desc TEXT,
  qty INTEGER
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  item TEXT,
  item_desc TEXT,
  price REAL,
  date TEXT
);
`);

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

// ---------------------------------------------------------
// Middleware
// ---------------------------------------------------------
function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ error: "Admin only" });
  next();
}

app.use('/api', verifyToken);

// ---------------------------------------------------------
// Auth: Register
// ---------------------------------------------------------
app.post("/api/register", async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role)
    return res.status(400).json({ error: "Missing fields" });

  const hash = bcrypt.hashSync(password, 10);

  try {
    await run(
      `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
      [username, email, hash, role]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({ error: "User exists or invalid data" });
  }
});

// ---------------------------------------------------------
// Auth: Login
// ---------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const users = await all(`SELECT * FROM users WHERE email = ?`, [email]);
    const user = users[0];

    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------------------------------------------------
// Sneakers endpoints
// ---------------------------------------------------------
app.get("/api/sneakers", async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM sneakers ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/sneakers", async (req, res) => {
  const { name, image, price = 0, desc = '', qty = 0 } = req.body;

  if (!name) return res.status(400).json({ error: "Missing name" });

  try {
    const result = await run(
      `INSERT INTO sneakers (name, image, price, desc, qty) VALUES (?, ?, ?, ?, ?)`,
      [name, image, price, desc, qty]
    );

    const created = await get(`SELECT * FROM sneakers WHERE id = ?`, [result.id]);
    return res.json({ success: true, sneaker: created });
  } catch (err) {
    console.error('Create sneaker error:', err);
    return res.status(500).json({ error: "Insert failed" });
  }
});

app.put("/api/sneakers/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, image, price = 0, desc = '', qty = 0 } = req.body;

  try {
    await run(
      `UPDATE sneakers SET name = ?, image = ?, price = ?, desc = ?, qty = ? WHERE id = ?`,
      [name, image, price, desc, qty, id]
    );

    const updated = await get(`SELECT * FROM sneakers WHERE id = ?`, [id]);
    res.json({ success: true, sneaker: updated });
  } catch (err) {
    console.error('Update sneaker error:', err);
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/sneakers/:id", requireAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM sneakers WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// Staff endpoints
// ---------------------------------------------------------
app.get("/api/staff", async (req, res) => {
  try {
    const rows = await all(`SELECT id, fullName, email, role FROM staff`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/staff", async (req, res) => {
  const { fullName, email, role, password } = req.body;

  if (!fullName || !email || !role || !password)
    return res.status(400).json({ error: 'Missing fields' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await run(
      `INSERT INTO staff (fullName, email, role, password) VALUES (?, ?, ?, ?)`,
      [fullName, email, role, hash]
    );

    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Add staff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// Purchases endpoints
// ---------------------------------------------------------
app.get("/api/purchase", requireAdmin, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM purchases ORDER BY date DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/purchase/:userId", async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM purchases WHERE user_id = ? ORDER BY date DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save purchase (offline sync)
app.post("/api/purchase", async (req, res) => {
  const p = req.body;

  if (!p || !p.items || !p.items.length)
    return res.status(400).json({ error: "Invalid purchase payload" });

  try {
    let userId = null;

    if (p.user && Number.isInteger(Number(p.user))) {
      userId = Number(p.user);
    } else if (p.user) {
      const rows = await all(
        `SELECT id FROM users WHERE email = ? OR username = ?`,
        [p.user, p.user]
      );
      if (rows && rows.length) userId = rows[0].id;
    }

    for (const it of p.items) {
      await run(
        `INSERT INTO purchases (user_id, item, item_desc, price, date)
         VALUES (?, ?, ?, ?, ?)`,
        [
          userId,
          it.name || '',
          it.desc || '',
          Number(it.price || 0),
          p.datetime || new Date().toISOString()
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Insert purchase error:', err);
    res.status(500).json({ error: 'Failed to save purchase' });
  }
});

// ---------------------------------------------------------
// Daily Revenue (Dashboard Chart)
// ---------------------------------------------------------
app.get("/api/sales/daily", async (req, res) => {
  try {
    const rows = await all(`
      SELECT 
        DATE(date) AS day,
        SUM(price) AS total
      FROM purchases
      GROUP BY DATE(date)
      ORDER BY day ASC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load daily revenue" });
  }
});

// ---------------------------------------------------------
//  Dashboard Stats (Frontend Uses These)
// ---------------------------------------------------------
app.get("/api/stats/users", async (req, res) => {
  try {
    const row = await get(`SELECT COUNT(*) AS total FROM users`);
    res.json({ total: row.total });
  } catch {
    res.status(500).json({ error: "Failed to load user count" });
  }
});

app.get("/api/stats/staff", async (req, res) => {
  try {
    const row = await get(`SELECT COUNT(*) AS total FROM staff`);
    res.json({ total: row.total });
  } catch {
    res.status(500).json({ error: "Failed to load staff count" });
  }
});

app.get("/api/stats/products", async (req, res) => {
  try {
    const row = await get(`SELECT COUNT(*) AS total FROM sneakers`);
    res.json({ total: row.total });
  } catch {
    res.status(500).json({ error: "Failed to load product count" });
  }
});

app.get("/api/stats/revenue", async (req, res) => {
  try {
    const row = await get(`SELECT SUM(price) AS total FROM purchases`);
    res.json({ total: row.total || 0 });
  } catch {
    res.status(500).json({ error: "Failed to load revenue" });
  }
});

// ---------------------------------------------------------
// Server
// ---------------------------------------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`Backend running: http://localhost:${PORT}`)
);
