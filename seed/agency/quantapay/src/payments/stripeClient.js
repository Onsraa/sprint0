// stripeClient.js — thin wrapper around the Stripe SDK.
// Centralizes the client so the rest of the app never imports `stripe` directly.
//
// NOTE: wired to ./mockStripe (an in-process FAKE Stripe) instead of the real
// `stripe` package, so QuantaPay runs locally with NO Stripe key. To go live,
// swap the import below for:  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
// — the wrapper functions keep the same shape.

const { mockStripe: stripe } = require('./mockStripe');

/**
 * Find-or-create a Stripe Customer for one of our users.
 * We store the returned id on the user row so this is idempotent per user.
 */
async function ensureCustomer({ userId, email, existingCustomerId }) {
  if (existingCustomerId) {
    return stripe.customers.retrieve(existingCustomerId);
  }
  return stripe.customers.create({
    email,
    metadata: { app_user_id: String(userId) },
  });
}

/**
 * Create a Checkout Session for a subscription price.
 * `priceId` is a Stripe Price (e.g. price_123), not a Product.
 */
async function createSubscriptionCheckout({ customerId, priceId, successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Lets us reconcile the webhook back to the originating customer.
    subscription_data: { metadata: { app_customer_id: customerId } },
  });
}

/**
 * Create the subscription itself. Real Stripe normally creates this from the
 * completed Checkout Session; the mock lets us do it directly when the user
 * "completes" the fake hosted checkout.
 */
async function createSubscription({ customerId, priceId }) {
  return stripe.subscriptions.create({
    customer: customerId,
    priceId,
    metadata: { app_customer_id: customerId },
  });
}

/** Cancel at period end so the user keeps access until they've paid through. */
async function cancelSubscription(subscriptionId, { immediately = false } = {}) {
  if (immediately) {
    return stripe.subscriptions.cancel(subscriptionId);
  }
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

/** Open the hosted billing portal so users self-manage cards/invoices. */
async function createBillingPortalSession({ customerId, returnUrl }) {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

module.exports = {
  stripe,
  ensureCustomer,
  createSubscriptionCheckout,
  createSubscription,
  cancelSubscription,
  createBillingPortalSession,
};
