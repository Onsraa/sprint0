// mockStripe.js — an in-process FAKE Stripe. NO network, NO API key needed.
//
// This stands in for the real `stripe` npm package so the whole app runs
// locally with zero external services. It implements just the slice of the
// Stripe surface that QuantaPay touches:
//   - customers.create / customers.retrieve
//   - checkout.sessions.create   (returns a fake hosted-checkout URL)
//   - subscriptions.create / .update / .cancel / .retrieve
//   - webhooks.constructEvent    (verifies our own fake signature)
//   - a tiny EventEmitter so "Stripe" can POST events back to our webhook,
//     exactly like the real Stripe would.
//
// Object shapes mirror the real Stripe API (snake_case fields like
// `current_period_end`, `cancel_at_period_end`) so downstream code that was
// written against real Stripe keeps working unchanged.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_quantapay';

// In-memory "Stripe-side" storage.
const customers = new Map();
const subscriptions = new Map();
const checkoutSessions = new Map();

// Bus that emits Stripe-style events. server.js subscribes the webhook to it.
const events = new EventEmitter();

let seq = 0;
const id = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${crypto.randomBytes(3).toString('hex')}`;

const THIRTY_DAYS = 30 * 24 * 60 * 60; // seconds

// Build a Stripe-shaped event envelope and sign it the way our fake
// constructEvent expects. Then emit it on the next tick (mimics async delivery).
function emitEvent(type, object) {
  const payload = {
    id: id('evt'),
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = sign(raw);
  // Deliver asynchronously, like a real webhook callback.
  setImmediate(() => events.emit('event', { raw, signature }));
  return payload;
}

// HMAC the raw body with the webhook secret — same idea as Stripe's signing,
// just without the timestamp tolerance dance.
function sign(rawBuffer) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBuffer).digest('hex');
}

function buildSubscriptionObject(sub) {
  return {
    id: sub.id,
    object: 'subscription',
    customer: sub.customer,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_end: sub.current_period_end,
    items: { data: [{ price: { id: sub.priceId } }] },
    metadata: sub.metadata || {},
  };
}

const mockStripe = {
  // ---- Customers --------------------------------------------------------
  customers: {
    async create({ email, metadata } = {}) {
      const customer = { id: id('cus'), object: 'customer', email, metadata: metadata || {} };
      customers.set(customer.id, customer);
      return customer;
    },
    async retrieve(customerId) {
      const c = customers.get(customerId);
      if (!c) throw new Error(`No such customer: ${customerId}`);
      return c;
    },
  },

  // ---- Checkout ---------------------------------------------------------
  checkout: {
    sessions: {
      // In real Stripe this returns a hosted page URL the user is redirected to.
      // Here we return a local URL our own server handles to "complete" payment.
      async create({ customer, line_items, success_url, cancel_url, subscription_data } = {}) {
        const priceId = line_items?.[0]?.price;
        const session = {
          id: id('cs'),
          object: 'checkout.session',
          customer,
          mode: 'subscription',
          priceId,
          success_url,
          cancel_url,
          subscription_metadata: subscription_data?.metadata || {},
          // The mock "hosted checkout" page lives on our own server.
          url: `/mock-checkout?session_id=__SID__`,
        };
        session.url = `/mock-checkout?session_id=${session.id}`;
        checkoutSessions.set(session.id, session);
        return session;
      },
      retrieve(sessionId) {
        return checkoutSessions.get(sessionId);
      },
    },
  },

  // ---- Subscriptions ----------------------------------------------------
  subscriptions: {
    async create({ customer, priceId, metadata } = {}) {
      const sub = {
        id: id('sub'),
        customer,
        priceId,
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: Math.floor(Date.now() / 1000) + THIRTY_DAYS,
        metadata: metadata || {},
      };
      subscriptions.set(sub.id, sub);
      const obj = buildSubscriptionObject(sub);
      emitEvent('customer.subscription.created', obj);
      return obj;
    },
    async update(subscriptionId, params = {}) {
      const sub = subscriptions.get(subscriptionId);
      if (!sub) throw new Error(`No such subscription: ${subscriptionId}`);
      if (typeof params.cancel_at_period_end === 'boolean') {
        sub.cancel_at_period_end = params.cancel_at_period_end;
      }
      const obj = buildSubscriptionObject(sub);
      emitEvent('customer.subscription.updated', obj);
      return obj;
    },
    async cancel(subscriptionId) {
      const sub = subscriptions.get(subscriptionId);
      if (!sub) throw new Error(`No such subscription: ${subscriptionId}`);
      sub.status = 'canceled';
      sub.cancel_at_period_end = true;
      const obj = buildSubscriptionObject(sub);
      emitEvent('customer.subscription.deleted', obj);
      return obj;
    },
    async retrieve(subscriptionId) {
      const sub = subscriptions.get(subscriptionId);
      if (!sub) throw new Error(`No such subscription: ${subscriptionId}`);
      return buildSubscriptionObject(sub);
    },
  },

  // ---- Billing portal (stub) -------------------------------------------
  billingPortal: {
    sessions: {
      async create({ customer, return_url } = {}) {
        return { id: id('bps'), url: `${return_url || '/'}?portal=mock&customer=${customer}` };
      },
    },
  },

  // ---- Webhook signature verification ----------------------------------
  // Mirrors stripe.webhooks.constructEvent: throws if the signature doesn't
  // match the raw body, otherwise returns the parsed event.
  webhooks: {
    constructEvent(rawBody, signature, secret) {
      const expected = crypto
        .createHmac('sha256', secret || WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
      const a = Buffer.from(signature || '', 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error('Invalid signature for mock Stripe webhook');
      }
      return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    },
  },
};

module.exports = { mockStripe, events, WEBHOOK_SECRET };
