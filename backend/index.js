process.env.USE_SQLITE = "false";

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { Pool } from "pg";

// ---------------------------------------------
// Setup
// ---------------------------------------------
dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const isProduction = process.env.NODE_ENV === "production";

let db = null;
let pool = null;

// ---------------------------------------------
// Database selection
// ---------------------------------------------
if (isProduction) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log(" Using PostgreSQL (Render)");
} else {
    sqlite3.verbose();
    db = new sqlite3.Database("./uwv-dev.db");
    console.log(" Using SQLite (Local Development)");
}

// ---------------------------------------------
// Helper wrappers
// ---------------------------------------------
const query = async (text, params = []) => {
    if (!isProduction) throw new Error("query() allowed only in production");
    return pool.query(text, params);
};

const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
        if (!isProduction) {
            db.all(sql.replace(/\$\d+/g, "?"), params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        } else {
            pool.query(sql, params).then(r => resolve(r.rows)).catch(reject);
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
            pool.query(sql, params).then(r => resolve(r.rows[0])).catch(reject);
        }
    });

// ---------------------------------------------
// Create tables
// ---------------------------------------------
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
        console.log(" PostgreSQL tables ready");
    } else {
        db.exec(sqlSQLite);
        console.log(" SQLite tables ready");
    }
}

// ---------------------------------------------
// Middleware
// ---------------------------------------------
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

app.use("/api", verifyToken);

// ---------------------------------------------
// AUTH Routes
// ---------------------------------------------
app.post("/api/register", async (req, res) => {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password || !role)
        return res.status(400).json({ error: "Missing fields" });

    const hash = bcrypt.hashSync(password, 10);

    try {
        const { rows } = await pool.query(
            `INSERT INTO users (username, email, password, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [username, email, hash, role]
        );

        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        console.error("Register error:", err);
        res.status(400).json({ error: "User already exists or invalid data" });
    }
});

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
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// ---------------------------------------------
// SNEAKERS
// ---------------------------------------------
app.get("/api/sneakers", async (_, res) => {
    try {
        const rows = await all(`SELECT * FROM sneakers ORDER BY id DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

app.post("/api/sneakers", async (req, res) => {
    const { name, image, price = 0, desc = "", qty = 0 } = req.body;

    if (!name) return res.status(400).json({ error: "Missing name" });

    try {
        const result = await pool.query(
            `INSERT INTO sneakers (name, image, price, "desc", qty)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [name, image, price, desc, qty]
        );

        res.json({ success: true, sneaker: result.rows[0] });
    } catch (err) {
        console.error("Create sneaker error:", err);
        res.status(500).json({ error: "Failed to create sneaker" });
    }
});

// ---------------------------------------------
// STAFF
// ---------------------------------------------
app.get("/api/staff", async (_, res) => {
    try {
        const rows = await all(`SELECT id, "fullName", email, role FROM staff`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------
// PURCHASES
// ---------------------------------------------
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
            if (rows.length) userId = rows[0].id;
        }

        for (const it of p.items) {
            await query(
                `INSERT INTO purchases (user_id, item, item_desc, price, date)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    userId,
                    it.name || "",
                    it.desc || "",
                    Number(it.price || 0),
                    p.datetime || new Date().toISOString()
                ]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Purchase error:", err);
        res.status(500).json({ error: "Failed to save purchase" });
    }
});

// ---------------------------------------------
//  Serve frontend (AFTER API ROUTES)
// ---------------------------------------------
app.use(express.static(path.join(__dirname, "../")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../index.html"));
});

// ---------------------------------------------
// Start Server
// ---------------------------------------------
const PORT = process.env.PORT || 3001;

(async () => {
    try {
        await ensureTables();
        app.listen(PORT, () =>
            console.log(` Server running on port ${PORT}`)
        );
    } catch (err) {
        console.error("Startup error:", err);
        process.exit(1);
    }
})();
