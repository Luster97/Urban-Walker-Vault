import sqlite3 from "sqlite3";
import { Pool } from "pg";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// JWT secret fallback (to avoid crashing)
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Create Express app BEFORE using it
const app = express();
app.use(cors());
app.use(bodyParser.json());


const isProduction = process.env.NODE_ENV === "production";
let db = null;
let pool = null;

// -----------------------------
//  SELECT DATABASE ENGINE
// -----------------------------
if (isProduction) {
  //  Production → PostgreSQL (Render)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log(" Using PostgreSQL (Render)");
} else {
  //  Development → SQLite (local)
  sqlite3.verbose();
  db = new sqlite3.Database("./uwv-dev.db");
  console.log(" Using SQLite (Local)");
}

//  Helper wrappers so the rest of your code stays the same
const query = async (text, params = []) => {
  if (!isProduction) throw new Error("query() is for Postgres only");
  return await pool.query(text, params);
};

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    if (!isProduction) {
      db.all(sql.replace(/\$\d+/g, "?"), params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    } else {
      pool.query(sql, params).then(res => resolve(res.rows)).catch(reject);
    }
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    if (!isProduction) {
      db.get(sql.replace(/\$\d+/g, "?"), params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    } else {
      pool.query(sql, params).then(res => resolve(res.rows[0])).catch(reject);
    }
  });

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    if (!isProduction) {
      db.run(sql.replace(/\$\d+/g, "?"), params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    } else {
      pool.query(sql, params)
        .then(res => resolve(res.rows?.[0] || {}))
        .catch(reject);
    }
  });

// Create tables if they don't exist (run once at startup)
async function ensureTables() {
  const sqlSQLite = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT,
      email TEXT UNIQUE,
      role TEXT,
      password TEXT
    );

    CREATE TABLE IF NOT EXISTS sneakers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      image TEXT,
      price REAL,
      desc TEXT,
      qty INTEGER
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      item TEXT,
      item_desc TEXT,
      price REAL,
      date TEXT
    );
  `;

  const sqlPostgres = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      "fullName" TEXT,
      email TEXT UNIQUE,
      role TEXT,
      password TEXT
    );

    CREATE TABLE IF NOT EXISTS sneakers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      image TEXT,
      price NUMERIC,
      "desc" TEXT,
      qty INTEGER
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      item TEXT,
      item_desc TEXT,
      price NUMERIC,
      date TIMESTAMP
    );
  `;

  if (isProduction) {
    await pool.query(sqlPostgres);
    console.log(" Postgres tables ready");
  } else {
    db.exec(sqlSQLite);
    console.log(" SQLite tables ready");
  }
}

// Middleware
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

// ---------------- Auth: Register ----------------
app.post("/api/register", async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role)
    return res.status(400).json({ error: "Missing fields" });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const q = `INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id`;
    const { rows } = await pool.query(q, [username, email, hash, role]);
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({ error: "User exists or invalid data" });
  }
});

// ---------------- Auth: Login ----------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const rows = await all(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------- Sneakers endpoints ----------------
app.get("/api/sneakers", async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM sneakers ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/sneakers", async (req, res) => {
  const { name, image, price = 0, desc = '', qty = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "Missing name" });
  try {
    const q = `INSERT INTO sneakers (name, image, price, "desc", qty) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const result = await pool.query(q, [name, image, price, desc, qty]);
    return res.json({ success: true, sneaker: result.rows[0] });
  } catch (err) {
    console.error('Create sneaker error:', err);
    return res.status(500).json({ error: "Insert failed" });
  }
});

app.put("/api/sneakers/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, image, price = 0, desc = '', qty = 0 } = req.body;
  try {
    await query(
      `UPDATE sneakers SET name = $1, image = $2, price = $3, "desc" = $4, qty = $5 WHERE id = $6`,
      [name, image, price, desc, qty, id]
    );
    const updated = await get(`SELECT * FROM sneakers WHERE id = $1`, [id]);
    res.json({ success: true, sneaker: updated });
  } catch (err) {
    console.error('Update sneaker error:', err);
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/sneakers/:id", requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM sneakers WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Staff endpoints ----------------
app.get("/api/staff", async (req, res) => {
  try {
    const rows = await all(`SELECT id, "fullName", email, role FROM staff`);
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
    const result = await pool.query(
      `INSERT INTO staff ("fullName", email, role, password) VALUES ($1, $2, $3, $4) RETURNING id`,
      [fullName, email, role, hash]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Add staff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Purchases endpoints ----------------
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
      `SELECT * FROM purchases WHERE user_id = $1 ORDER BY date DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
        `SELECT id FROM users WHERE email = $1 OR username = $2`,
        [p.user, p.user]
      );
      if (rows && rows.length) userId = rows[0].id;
    }
    for (const it of p.items) {
      await query(
        `INSERT INTO purchases (user_id, item, item_desc, price, date) VALUES ($1, $2, $3, $4, $5)`,
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

// ---------------- Sales daily & Stats ----------------
app.get("/api/sales/daily", async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        date::date AS day,
        SUM(price)::numeric AS total
      FROM purchases
      GROUP BY date::date
      ORDER BY day ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load daily revenue" });
  }
});

app.get("/api/stats/users", async (req, res) => {
  try {
    const row = await get(`SELECT COUNT(*)::int AS total FROM users`);
    res.json({ total: row.total });
  } catch {
    res.status(500).json({ error: "Failed to load user count" });
  }
});

app.get("/api/stats/staff", async (req, res) => {
  try {
    const row = await get(`SELECT COUNT(*)::int AS total FROM staff`);
    res.json({ total: row.total });
  } catch {
    res.status(500).json({ error: "Failed to load staff count" });
  }
});

app.get("/api/stats/products", async (req, res) => {
  try {
    const row = await get(`SELECT COUNT(*)::int AS total FROM sneakers`);
    res.json({ total: row.total });
  } catch {
    res.status(500).json({ error: "Failed to load product count" });
  }
});

app.get("/api/stats/revenue", async (req, res) => {
  try {
    const row = await get(`SELECT COALESCE(SUM(price),0)::numeric AS total FROM purchases`);
    res.json({ total: parseFloat(row.total) || 0 });
  } catch {
    res.status(500).json({ error: "Failed to load revenue" });
  }
});

// Root
app.get("/", (_, res) => res.send("UWV backend (Postgres) is running"));

// Start server: ensure tables then listen
const PORT = process.env.PORT || 3001;
(async () => {
  try {
    await ensureTables();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
})();
