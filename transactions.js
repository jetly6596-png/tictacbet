// api/transactions.js
// Vercel Serverless Function — handles POST /api/transactions
// Body: { action: "deposit"|"withdraw", amount }
// Headers: { Authorization: "Bearer <jwt>" }
//
// Required environment variables (set in Vercel dashboard):
//   DATABASE_URL   — your Neon connection string
//   JWT_SECRET     — same value used in api/auth.js

import { neon } from "@neondatabase/serverless";
import jwt from "jsonwebtoken";

const sql = neon(process.env.DATABASE_URL);

// One-time table creation (idempotent)
async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS balances (
      user_id   INT PRIMARY KEY REFERENCES users(id),
      amount    NUMERIC(12, 2) NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id),
      type       TEXT NOT NULL,
      amount     NUMERIC(12, 2) NOT NULL,
      balance_after NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

function getUserFromToken(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // ── GET: fetch balance + recent transactions ───────────────
  if (req.method === "GET") {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    try {
      await ensureTables();

      const [balance] = await sql`
        SELECT amount FROM balances WHERE user_id = ${user.userId}
      `;
      const history = await sql`
        SELECT type, amount, balance_after, created_at
        FROM transactions
        WHERE user_id = ${user.userId}
        ORDER BY created_at DESC
        LIMIT 20
      `;

      return res.status(200).json({
        balance: balance?.amount ?? "0.00",
        transactions: history,
      });
    } catch (err) {
      console.error("[transactions GET]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // ── POST: deposit or withdraw ──────────────────────────────
  if (req.method === "POST") {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { action, amount } = req.body ?? {};
    const numericAmount = parseFloat(amount);

    if (!action || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "action and a positive amount are required" });
    }
    if (!["deposit", "withdraw"].includes(action)) {
      return res.status(400).json({ error: "action must be 'deposit' or 'withdraw'" });
    }

    try {
      await ensureTables();

      // Upsert balance row so every user starts at 0
      await sql`
        INSERT INTO balances (user_id, amount) VALUES (${user.userId}, 0)
        ON CONFLICT (user_id) DO NOTHING
      `;

      // Lock the row for this transaction
      const [current] = await sql`
        SELECT amount FROM balances WHERE user_id = ${user.userId} FOR UPDATE
      `;
      const currentBalance = parseFloat(current.amount);

      if (action === "withdraw" && numericAmount > currentBalance) {
        return res.status(422).json({ error: "Insufficient funds" });
      }

      const newBalance =
        action === "deposit"
          ? currentBalance + numericAmount
          : currentBalance - numericAmount;

      await sql`
        UPDATE balances SET amount = ${newBalance} WHERE user_id = ${user.userId}
      `;

      const [txn] = await sql`
        INSERT INTO transactions (user_id, type, amount, balance_after)
        VALUES (${user.userId}, ${action}, ${numericAmount}, ${newBalance})
        RETURNING id, type, amount, balance_after, created_at
      `;

      return res.status(200).json({ transaction: txn, balance: newBalance.toFixed(2) });
    } catch (err) {
      console.error("[transactions POST]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
