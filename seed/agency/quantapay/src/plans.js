// plans.js — the subscription catalog (seed data).
// In a real Stripe setup these priceIds map to Stripe Prices; here they're
// just labels the mock Stripe echoes back through the subscription lifecycle.

const PLANS = [
  { priceId: 'price_starter', name: 'Starter', amount: 900, interval: 'month' },
  { priceId: 'price_pro', name: 'Pro', amount: 2900, interval: 'month' },
  { priceId: 'price_scale', name: 'Scale', amount: 9900, interval: 'month' },
];

function findPlan(priceId) {
  return PLANS.find((p) => p.priceId === priceId) || null;
}

module.exports = { PLANS, findPlan };
