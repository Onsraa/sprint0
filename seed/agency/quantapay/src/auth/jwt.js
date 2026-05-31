// jwt.js — access/refresh token issuing + Express auth middleware.
// Access tokens are short-lived and sent as Bearer; refresh tokens are long-lived
// and rotated. Secrets come from env so this drops into any service unchanged.

const jwt = require('jsonwebtoken');

// Defaults let the demo run with zero env config. SET THESE in production.
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-not-for-prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-not-for-prod';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d';

function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

/** Issue both tokens at login. `mfa` flags whether 2FA was satisfied this session. */
function issueTokens(user) {
  const claims = { sub: user.id, email: user.email, mfa: Boolean(user.mfaVerified) };
  return {
    accessToken: signAccessToken(claims),
    refreshToken: signRefreshToken({ sub: user.id }),
  };
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Express middleware: require a valid access token.
 * Attaches the decoded claims to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing_bearer_token' });
  }

  try {
    req.user = jwt.verify(token, ACCESS_SECRET);
    return next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
    return res.status(401).json({ error: code });
  }
}

/** Gate routes that must not be reached until 2FA has been completed. */
function require2FA(req, res, next) {
  if (!req.user?.mfa) {
    return res.status(403).json({ error: 'mfa_required' });
  }
  return next();
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  issueTokens,
  verifyRefreshToken,
  requireAuth,
  require2FA,
};
