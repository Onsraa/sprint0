// server.js — QuantaPay API + static frontend, fully self-contained.
//
// Wires the reusable modules (jwt, twoFactor, stripeClient, webhookHandler,
// subscription model) into a runnable Express app backed by SQLite and a
// MOCK Stripe. No external services, no API keys.

const path = require('path');
const express = require('express');

const { issueTokens, requireAuth } = require('./auth/jwt');
const { generateSecret, toQrDataUrl, verifyToken } = require('./auth/twoFactor');
const users = require('./models/user');
const subscriptions = require('./models/subscription');
const { ensureCustomer, createSubscriptionCheckout, createSubscription, cancelSubscription, stripe } = require('./payments/stripeClient');
const { events } = require('./payments/mockStripe');
const { stripeWebhook } = require('./payments/webhookHandler');
const { PLANS, findPlan } = require('./plans');

const app = express();
const PORT = process.env.PORT || 4242;

// ---------------------------------------------------------------------------
// Mock Stripe delivers webhook events here, exactly like real Stripe would
// POST to /webhooks/stripe. We synthesize a req/res and run the SAME handler
// (signature verification + idempotency) the production code uses.
// ---------------------------------------------------------------------------
events.on('event', async ({ raw, signature }) => {
  const req = { headers: { 'stripe-signature': signature }, body: raw };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { return this; },
    send() { return this; },
  };
  try {
    await stripeWebhook(req, res);
  } catch (err) {
    console.error('[webhook] handler error:', err.message);
  }
});

// ---------------------------------------------------------------------------
// Stripe webhook endpoint. Real Stripe needs the RAW body for signature
// verification, so this route is mounted with express.raw() BEFORE json().
// (In this demo the mock posts internally via the emitter above, but the HTTP
// route is here too so it behaves like the real deployment.)
// ---------------------------------------------------------------------------
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- helpers ---------------------------------------------------------------
function publicUser(u) {
  return { id: u.id, email: u.email, mfaEnabled: u.mfaEnabled, stripeCustomerId: u.stripeCustomerId };
}

// ===========================================================================
// Auth
// ===========================================================================

// Sign up: create user, mint a Stripe (mock) customer, return tokens.
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
  if (users.findByEmail(email)) return res.status(409).json({ error: 'email_taken' });

  const user = users.createUser(email, password);
  const customer = await ensureCustomer({ userId: user.id, email });
  users.setStripeCustomerId(user.id, customer.id);
  const fresh = users.findById(user.id);

  // No 2FA yet, so the session is mfa:false until they enroll + verify.
  const tokens = issueTokens({ id: fresh.id, email: fresh.email, mfaVerified: false });
  return res.status(201).json({ user: publicUser(fresh), ...tokens });
});

// Login step 1: verify password. If 2FA is enabled, hold back the access
// token until the TOTP code is verified (step 2).
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.findByEmail(email || '');
  if (!user || !users.verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  if (user.mfaEnabled) {
    return res.json({ mfaRequired: true, userId: user.id });
  }

  const tokens = issueTokens({ id: user.id, email: user.email, mfaVerified: false });
  return res.json({ user: publicUser(user), ...tokens });
});

// Login step 2: verify the TOTP code, then issue an mfa:true session.
app.post('/api/login/2fa', async (req, res) => {
  const { userId, token } = req.body || {};
  const user = users.findById(Number(userId));
  if (!user || !user.mfaEnabled || !user.totpSecret) {
    return res.status(400).json({ error: 'mfa_not_enrolled' });
  }
  if (!verifyToken(user.totpSecret, token)) {
    return res.status(401).json({ error: 'invalid_totp_code' });
  }
  const tokens = issueTokens({ id: user.id, email: user.email, mfaVerified: true });
  return res.json({ user: publicUser(user), ...tokens });
});

// ===========================================================================
// 2FA enrollment (requires a logged-in session)
// ===========================================================================

// Generate + persist a TOTP secret, return the QR + otpauth URL + raw secret.
// (We surface the secret/URL so the demo is usable WITHOUT a phone — paste the
//  secret into any TOTP tool, or scan the QR.)
app.post('/api/2fa/setup', requireAuth, async (req, res) => {
  const user = users.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const { base32, otpauthUrl } = generateSecret(user.email);
  users.setTotpSecret(user.id, base32);
  const qrDataUrl = await toQrDataUrl(otpauthUrl);
  return res.json({ secret: base32, otpauthUrl, qrDataUrl });
});

// Verify the first code to confirm enrollment, then flip mfa_enabled on.
app.post('/api/2fa/verify', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  const user = users.findById(req.user.sub);
  if (!user || !user.totpSecret) return res.status(400).json({ error: 'no_pending_2fa' });

  if (!verifyToken(user.totpSecret, token)) {
    return res.status(401).json({ error: 'invalid_totp_code' });
  }
  users.enableMfa(user.id);

  // Re-issue tokens with mfa:true so this session is now fully authenticated.
  const fresh = users.findById(user.id);
  const tokens = issueTokens({ id: fresh.id, email: fresh.email, mfaVerified: true });
  return res.json({ enabled: true, user: publicUser(fresh), ...tokens });
});

// ===========================================================================
// Subscriptions (mock Stripe Checkout)
// ===========================================================================

app.get('/api/plans', (_req, res) => res.json({ plans: PLANS }));

// Kick off "checkout": create a mock Checkout Session and hand back its URL.
app.post('/api/subscribe', requireAuth, async (req, res) => {
  const { priceId } = req.body || {};
  if (!findPlan(priceId)) return res.status(400).json({ error: 'unknown_plan' });

  const user = users.findById(req.user.sub);
  const session = await createSubscriptionCheckout({
    customerId: user.stripeCustomerId,
    priceId,
    successUrl: '/?checkout=success',
    cancelUrl: '/?checkout=cancel',
  });
  return res.json({ checkoutUrl: session.url, sessionId: session.id });
});

// "Complete" the fake hosted checkout: create the subscription, which makes
// mock Stripe emit customer.subscription.created -> our webhook persists it.
app.post('/api/mock-checkout/complete', requireAuth, async (req, res) => {
  const { sessionId } = req.body || {};
  const session = stripe.checkout.sessions.retrieve(sessionId);
  if (!session) return res.status(404).json({ error: 'unknown_session' });

  const sub = await createSubscription({ customerId: session.customer, priceId: session.priceId });
  return res.json({ subscriptionId: sub.id, status: sub.status });
});

// Current subscription status for the logged-in user's customer.
app.get('/api/subscription', requireAuth, async (req, res) => {
  const user = users.findById(req.user.sub);
  const sub = subscriptions.getByCustomer(user.stripeCustomerId);
  const active = await subscriptions.hasActiveSubscription(user.stripeCustomerId);
  return res.json({ subscription: sub, active, plan: sub ? findPlan(sub.stripePriceId) : null });
});

// Cancel at period end (emits subscription.updated through the webhook).
app.post('/api/subscription/cancel', requireAuth, async (req, res) => {
  const user = users.findById(req.user.sub);
  const sub = subscriptions.getByCustomer(user.stripeCustomerId);
  if (!sub) return res.status(404).json({ error: 'no_subscription' });
  await cancelSubscription(sub.stripeSubscriptionId);
  return res.json({ ok: true });
});

// ===========================================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('\n  QuantaPay (self-contained demo) running');
    console.log(`  → open http://localhost:${PORT}\n`);
    console.log('  Mock Stripe active — no API key needed.');
    console.log('  2FA secrets are printed to the page so you can test without a phone.\n');
  });
}

module.exports = { app };
