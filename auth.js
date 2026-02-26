// api/auth.js
// Vercel Serverless Function — handles POST /api/auth
// Body: { action: "signup"|"login", username, password }
//
// Required environment variables (set in Vercel dashboard):
//   DATABASE_URL   — your Neon connection string
//   JWT_SECRET     — any long random string

import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const sql = neon(process.env.DATABASE_URL);

// One-time table creation (idempotent — safe to leave in)
async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id        SERIAL PRIMARY KEY,
      username  TEXT UNIQUE NOT NULL,
      password  TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, username, password } = req.body ?? {};

  if (!action || !username || !password) {
    return res.status(400).json({ error: "action, username, and password are required" });
  }

  try {
    await ensureTable();

    // ── SIGNUP ────────────────────────────────────────────────
    if (action === "signup") {
      const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
      if (existing.length > 0) {
        return res.status(409).json({ error: "Username already taken" });
      }

      const hash = await bcrypt.hash(password, 10);
      const [user] = await sql`
        INSERT INTO users (username, password)
        VALUES (${username}, ${hash})
        RETURNING id, username
      `;

      const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return res.status(201).json({ token, username: user.username });
    }

    // ── LOGIN ─────────────────────────────────────────────────
    if (action === "login") {
      const [user] = await sql`SELECT * FROM users WHERE username = ${username}`;
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return res.status(200).json({ token, username: user.username });
    }

    return res.status(400).json({ error: "action must be 'signup' or 'login'" });
  } catch (err) {
    console.error("[auth]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
