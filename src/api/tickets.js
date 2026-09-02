const Stripe = require('stripe');
const { jsonOk, jsonErr } = require('./_utils');

// Price IDs come from env, not hardcoded — created once via
// `npm run setup-tickets` (scripts/setup-stripe-tickets.mjs), then marked
// as tickets in the Stripe Dashboard's Lomeo drawer (one-time, manual —
// Lomeo has no public API for that toggle). Once marked, Lomeo emits the
// QR ticket email itself on payment_intent.succeeded — no webhook needed here.
const TIERS = {
  student: { label: 'Student Ticket', envVar: 'STRIPE_PRICE_STUDENT' },
  normal:  { label: 'Normal Ticket',  envVar: 'STRIPE_PRICE_NORMAL' },
  premium: { label: 'Premium Ticket', envVar: 'STRIPE_PRICE_PREMIUM' },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return jsonErr(res, 500, 'STRIPE_SECRET_KEY not set');

  const tierKey = String(req.body?.tier || '').toLowerCase();
  const tier = TIERS[tierKey];
  if (!tier) return jsonErr(res, 400, `tier must be one of ${Object.keys(TIERS).join(', ')}`);

  const priceId = process.env[tier.envVar];
  if (!priceId) return jsonErr(res, 500, `${tier.envVar} not set — run npm run setup-tickets first`);

  const origin = process.env.PUBLIC_SITE_URL || req.headers.origin || `https://${req.headers.host}`;

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/tickets.html?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/tickets.html?status=cancelled`,
      metadata: { event: 'The Spring - The WAK - TUC Event', tier: tierKey },
    });
    return jsonOk(res, { url: session.url });
  } catch (err) {
    console.error('[tickets]', err);
    return jsonErr(res, 500, err.message);
  }
};
