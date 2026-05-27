// db.js — self-contained persistence with better-sqlite3.
// Replaces the original Prisma/Postgres layer so the app needs no database
// server. The DB file lives at ./data/quantapay.db (created on first run).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.QUANTAPAY_DB || path.join(DATA_DIR, 'quantapay.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    stripe_customer_id  TEXT,
    totp_secret         TEXT,
    mfa_enabled         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_subscription_id   TEXT UNIQUE NOT NULL,
    stripe_customer_id       TEXT NOT NULL,
    stripe_price_id          TEXT,
    status                   TEXT NOT NULL,
    current_period_end       TEXT,
    cancel_at_period_end     INTEGER NOT NULL DEFAULT 0
  );
`);

module.exports = { db };
