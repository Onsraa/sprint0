// user.js — user persistence (better-sqlite3). Passwords hashed with scrypt
// from Node's stdlib so there's no native bcrypt dependency to build.

const crypto = require('crypto');
const { db } = require('../db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, derived] = String(stored).split(':');
  if (!salt || !derived) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, 'hex');
  return check.length === expected.length && crypto.timingSafeEqual(check, expected);
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    stripeCustomerId: row.stripe_customer_id,
    totpSecret: row.totp_secret,
    mfaEnabled: Boolean(row.mfa_enabled),
  };
}

function createUser(email, password) {
  const info = db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email, hashPassword(password));
  return findById(info.lastInsertRowid);
}

function findByEmail(email) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(email));
}

function findById(id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function setStripeCustomerId(userId, customerId) {
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
}

function setTotpSecret(userId, base32) {
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(base32, userId);
}

function enableMfa(userId) {
  db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(userId);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createUser,
  findByEmail,
  findById,
  setStripeCustomerId,
  setTotpSecret,
  enableMfa,
};
