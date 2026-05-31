// webhookHandler.js — Stripe webhook receiver.
//
// Two things make this safe to copy into any project:
//   1. Signature verification with the raw request body (mount with express.raw()).
//   2. Idempotency — every event id is recorded so Stripe retries are no-ops.
//
//   app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

const { stripe } = require('./stripeClient');
const { WEBHOOK_SECRET } = require('./mockStripe');
const { upsertFromStripe, markCanceled } = require('../models/subscription');

// Swap for a Postgres/Redis-backed set in production. In-memory guard shown for clarity.
const processedEvents = new Set();

async function alreadyProcessed(eventId) {
  return processedEvents.has(eventId);
}
async function recordProcessed(eventId) {
  processedEvents.add(eventId);
}

async function stripeWebhook(req, res) {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    // req.body must be the raw Buffer, not parsed JSON, or verification fails.
    event = stripe.webhooks.constructEvent(req.body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: ack duplicates without re-running side effects.
  if (await alreadyProcessed(event.id)) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
    await recordProcessed(event.id);
  } catch (err) {
    // Non-2xx tells Stripe to retry — desirable for transient DB errors.
    console.error(`Failed handling ${event.type}:`, err);
    return res.status(500).json({ error: 'handler_failed' });
  }

  return res.status(200).json({ received: true });
}

async function handleEvent(event) {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await upsertFromStripe(event.data.object);
      break;

    case 'customer.subscription.deleted':
      await markCanceled(event.data.object.id);
      break;

    case 'invoice.payment_failed':
      // Downstream: flag account past_due, trigger dunning email.
      console.warn(`Payment failed for subscription ${event.data.object.subscription}`);
      break;

    default:
      // Unhandled types are fine — we just ack them so Stripe stops retrying.
      break;
  }
}

module.exports = { stripeWebhook, handleEvent };
