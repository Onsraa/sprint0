// subscription.js — subscription persistence.
// Maps Stripe subscription objects onto our own row + status enum so the
// rest of the app never has to think in Stripe vocabulary.
//
// NOTE: originally backed by Prisma/Postgres. Swapped to better-sqlite3 (see
// ../db.js) so the app is fully self-contained — the public API below is
// unchanged.

const { db } = require('../db');

// Our internal status enum. Stripe has more states than we care about.
const STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
};

// Stripe status string -> our enum.
function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
      return STATUS.ACTIVE;
    case 'trialing':
      return STATUS.TRIALING;
    case 'past_due':
    case 'unpaid':
      return STATUS.PAST_DUE;
    case 'canceled':
    case 'incomplete_expired':
      return STATUS.CANCELED;
    default:
      return STATUS.PAST_DUE;
  }
}

function rowToSubscription(row) {
  if (!row) return null;
  return {
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    stripePriceId: row.stripe_price_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  };
}

/**
 * Insert or update a subscription row from a Stripe subscription object.
 * Keyed on stripeSubscriptionId so it's safe to call on every webhook.
 */
async function upsertFromStripe(sub) {
  const data = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: sub.customer,
    stripePriceId: sub.items?.data?.[0]?.price?.id ?? null,
    status: mapStripeStatus(sub.status),
    currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
  };

  db.prepare(
    `INSERT INTO subscriptions
       (stripe_subscription_id, stripe_customer_id, stripe_price_id, status, current_period_end, cancel_at_period_end)
     VALUES (@stripeSubscriptionId, @stripeCustomerId, @stripePriceId, @status, @currentPeriodEnd, @cancelAtPeriodEnd)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET
       stripe_customer_id   = excluded.stripe_customer_id,
       stripe_price_id      = excluded.stripe_price_id,
       status               = excluded.status,
       current_period_end   = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end`,
  ).run(data);

  return rowToSubscription(
    db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(sub.id),
  );
}

async function markCanceled(stripeSubscriptionId) {
  db.prepare(
    `UPDATE subscriptions SET status = ?, cancel_at_period_end = 1
     WHERE stripe_subscription_id = ?`,
  ).run(STATUS.CANCELED, stripeSubscriptionId);

  return rowToSubscription(
    db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(stripeSubscriptionId),
  );
}

/** Used by plan-gating middleware to decide if a user has access. */
async function hasActiveSubscription(stripeCustomerId) {
  const sub = db
    .prepare(
      `SELECT 1 FROM subscriptions
       WHERE stripe_customer_id = ? AND status IN (?, ?) LIMIT 1`,
    )
    .get(stripeCustomerId, STATUS.ACTIVE, STATUS.TRIALING);
  return Boolean(sub);
}

/** Fetch the latest subscription for a customer (for the dashboard view). */
function getByCustomer(stripeCustomerId) {
  return rowToSubscription(
    db
      .prepare('SELECT * FROM subscriptions WHERE stripe_customer_id = ? ORDER BY id DESC LIMIT 1')
      .get(stripeCustomerId),
  );
}

module.exports = {
  STATUS,
  mapStripeStatus,
  upsertFromStripe,
  markCanceled,
  hasActiveSubscription,
  getByCustomer,
};
