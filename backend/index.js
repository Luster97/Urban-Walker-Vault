import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ----------------------------
//   Setup
// ----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});


// ----------------------------
//   Middleware
// ----------------------------
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

// ----------------------------
//   Database Helpers
// ----------------------------
const query = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
};

const queryOne = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows[0];
};

// ----------------------------
//   Auth Routes
// ----------------------------
app.post("/api/register", async (req, res) => {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role)
        return res.status(400).json({ error: "Missing fields" });

    try {
        const hash = bcrypt.hashSync(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [username, email, hash, role]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(400).json({ error: "User exists or invalid data" });
    }
});

app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;

    const rows = await query(`SELECT * FROM users WHERE email = $1`, [email]);
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
});

// ----------------------------
//   Sneakers
// ----------------------------
app.get("/api/sneakers", async (_, res) => {
    const rows = await query(`SELECT * FROM sneakers ORDER BY id DESC`);
    res.json(rows);
});

app.post("/api/sneakers", async (req, res) => {
    const { name, image, price = 0, desc = "", qty = 0 } = req.body;

    if (!name) return res.status(400).json({ error: "Missing name" });

    const result = await query(
        `INSERT INTO sneakers (name, image, price, "desc", qty)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name, image, price, desc, qty]
    );

    res.json({ success: true, sneaker: result[0] });
});

// ----------------------------
//   Staff
// ----------------------------
app.get("/api/staff", async (_, res) => {
    const rows = await query(
        `SELECT id, "fullName", email, role FROM staff`
    );
    res.json(rows);
});

// ----------------------------
//   Purchases
// ----------------------------
app.post("/api/purchase", async (req, res) => {
    const p = req.body;
    if (!p || !p.items?.length)
        return res.status(400).json({ error: "Invalid purchase payload" });

    for (const item of p.items) {
        await pool.query(
            `INSERT INTO purchases (user_id, item, item_desc, price, date)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                p.user || null,
                item.name,
                item.desc || "",
                Number(item.price || 0),
                new Date().toISOString()
            ]
        );
    }

    res.json({ success: true });
});

// ----------------------------

// ----------------------------
//   Server Start
// ----------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
    console.log(` UWV server running on port ${PORT}`)
);
