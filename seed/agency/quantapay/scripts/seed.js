// seed.js — optional convenience: create a demo user so you can skip signup.
// Safe to run multiple times. The app works fine without running this.

const users = require('../src/models/user');
const { ensureCustomer } = require('../src/payments/stripeClient');

const EMAIL = 'demo@quantapay.dev';
const PASSWORD = 'hunter2hunter2';

(async () => {
  let user = users.findByEmail(EMAIL);
  if (user) {
    console.log(`Demo user already exists: ${EMAIL}`);
    return;
  }
  user = users.createUser(EMAIL, PASSWORD);
  const customer = await ensureCustomer({ userId: user.id, email: EMAIL });
  users.setStripeCustomerId(user.id, customer.id);
  console.log('Seeded demo user:');
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
  console.log(`  stripe customer (mock): ${customer.id}`);
})();
