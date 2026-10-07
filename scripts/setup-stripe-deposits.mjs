import Stripe from 'stripe';

// ── Config ────────────────────────────────────────────────────────────────────
// 50% deposit products for the "reserve now, cash on event day" flow —
// separate products from the full-price tickets (not a discount applied to
// the same price) so they're easy to keep OFF the Lomeo ticket-tagging list:
// a deposit must never auto-issue a QR ticket, only the event-day cash
// top-up + manual check does.
const CURRENCY = 'myr';
const TIERS = [
  { key: 'student', productName: 'TUC Next Gen Pass — 50% Deposit', amount: 750 },   // RM7.50 (half of RM15)
  { key: 'normal',  productName: 'TUC Circular Pass — 50% Deposit', amount: 1750 },  // RM17.50 (half of RM35)
  { key: 'premium', productName: 'TUC Patron Pass — 50% Deposit',   amount: 5000 },  // RM50.00 (half of RM100)
];

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('❌  Set STRIPE_SECRET_KEY env var before running (test key is fine to start).');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const stripe = new Stripe(SECRET_KEY);

  const envLines = [];
  for (const tier of TIERS) {
    const product = await stripe.products.create({ name: tier.productName });
    const price = await stripe.prices.create({
      product: product.id,
      currency: CURRENCY,
      unit_amount: tier.amount,
    });
    console.log(`✅  ${tier.productName}: RM${(tier.amount / 100).toFixed(2)} → product ${product.id}, price ${price.id}`);
    envLines.push(`STRIPE_PRICE_${tier.key.toUpperCase()}_DEPOSIT=${price.id}`);
  }

  console.log('\nAdd these to your Vercel project env vars:\n');
  console.log(envLines.join('\n'));

  console.log(`
Important — do NOT toggle these as tickets in Lomeo. Leave them
untouched in the Lomeo drawer. Tagging them would auto-email a QR
ticket after just the 50% deposit, before the event-day cash balance
is ever collected.
`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
