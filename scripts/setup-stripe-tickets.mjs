import Stripe from 'stripe';

// ── Config ────────────────────────────────────────────────────────────────────
const EVENT_NAME = 'The Spring - The WAK - TUC Event';
const CURRENCY   = 'myr';
const TIERS = [
  { key: 'student', name: 'Student Ticket', amount: 1500 },  // RM15.00
  { key: 'normal',  name: 'Normal Ticket',  amount: 3500 },  // RM35.00
  { key: 'premium', name: 'Premium Ticket', amount: 10000 }, // RM100.00
];

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('❌  Set STRIPE_SECRET_KEY env var before running (test key is fine to start).');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const stripe = new Stripe(SECRET_KEY);

  const product = await stripe.products.create({ name: EVENT_NAME });
  console.log(`✅  Product created: ${product.name} (${product.id})`);

  const envLines = [];
  for (const tier of TIERS) {
    const price = await stripe.prices.create({
      product: product.id,
      currency: CURRENCY,
      unit_amount: tier.amount,
      nickname: tier.name,
    });
    console.log(`✅  ${tier.name}: RM${(tier.amount / 100).toFixed(2)} → ${price.id}`);
    envLines.push(`STRIPE_PRICE_${tier.key.toUpperCase()}=${price.id}`);
  }

  console.log('\nAdd these to your .env / Vercel project env vars:\n');
  console.log(envLines.join('\n'));

  console.log(`
Next step (manual, one-time — Lomeo has no API for this):
  1. Install Lomeo from https://marketplace.stripe.com/apps/lomeo if you haven't.
  2. Open the Stripe Dashboard → click the Lomeo icon at the top.
  3. Find "${EVENT_NAME}" in the product list and toggle all 3 prices ON as tickets.
  Once toggled, every Checkout Session paid against these prices auto-emails
  the buyer a QR ticket and enables door check-in — no code needed for that part.
`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
