// twoFactor.js — TOTP (RFC 6238) two-factor auth.
// Enrollment: generate a secret, render a QR for the authenticator app.
// Login: verify the 6-digit code with a small drift window for clock skew.

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const ISSUER = 'QuantaPay';

/**
 * Generate a fresh TOTP secret for a user enrolling in 2FA.
 * Persist `base32` against the user; show the QR once and never again.
 */
function generateSecret(userEmail) {
  const secret = speakeasy.generateSecret({
    name: `${ISSUER}:${userEmail}`,
    issuer: ISSUER,
    length: 20,
  });
  return {
    base32: secret.base32, // store this (encrypted at rest)
    otpauthUrl: secret.otpauth_url,
  };
}

/** Render the otpauth URL as a data-URI PNG to embed in the enrollment page. */
async function toQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

/**
 * Verify a 6-digit TOTP code.
 * `window: 1` accepts the adjacent 30s steps to tolerate clock drift.
 */
function verifyToken(base32Secret, token) {
  return speakeasy.totp.verify({
    secret: base32Secret,
    encoding: 'base32',
    token: String(token).trim(),
    window: 1,
  });
}

/** One-time backup codes for when the user loses their authenticator. */
function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(
      Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 6),
    );
  }
  return codes;
}

module.exports = {
  generateSecret,
  toQrDataUrl,
  verifyToken,
  generateBackupCodes,
};
