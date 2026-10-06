const Stripe = require('stripe');
const { jsonOk, jsonErr } = require('./_utils');

// Single dispatcher for ticket purchases AND reservations, kept as one Vercel
// function (not several) — the Hobby plan caps a deployment at 12 Serverless
// Functions, and this project is already exactly at that limit (see build.js).
//
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

// Reservations: pay RM0 now (card saved via a `setup` Checkout Session),
// charged automatically after this cutoff via a Stripe Invoice (not a raw
// PaymentIntent — Lomeo only watches Checkout Sessions, Payment Links, and
// Invoices, so Invoicing is the only way a reservation's eventual charge can
// still trigger the normal QR-ticket flow).
const RESERVATION_CUTOFF = new Date('2026-10-07T00:00:00+08:00'); // Asia/Kuala_Lumpur — TEST VALUE, change back to 20 Oct before real launch
const RESERVATIONS_SHEET_RANGE_ALL    = 'Reservations!A2:I';
const RESERVATIONS_SHEET_RANGE_APPEND = 'Reservations!A:I';
// Columns: A session_id | B email | C tier | D customer_id | E payment_method_id
//          F status | G reserved_at | H charged_at | I failure_reason

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(secretKey);
}

function getOrigin(req) {
  return process.env.PUBLIC_SITE_URL || req.headers.origin || `https://${req.headers.host}`;
}

// ── action: buy (default) — existing one-time ticket purchase, unchanged ──
async function actionBuy(req, res) {
  const tierKey = String(req.body?.tier || '').toLowerCase();
  const tier = TIERS[tierKey];
  if (!tier) return jsonErr(res, 400, `tier must be one of ${Object.keys(TIERS).join(', ')}`);

  const priceId = process.env[tier.envVar];
  if (!priceId) return jsonErr(res, 500, `${tier.envVar} not set — run npm run setup-tickets first`);

  const origin = getOrigin(req);

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // fpx temporarily disabled — not activated on the live Stripe account
      // yet (likely needs a Business Registration Number TUC doesn't have as
      // an unregistered entity). Re-add 'fpx' here once it's enabled live.
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
        // Lets buyers adjust quantity on Stripe's own Checkout page. Not yet
        // confirmed whether Lomeo issues one QR per unit or one QR for the
        // whole line item — test with quantity 2+ before relying on this.
        adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 },
      }],
      success_url: `${origin}/tickets.html?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/tickets.html?status=cancelled`,
      metadata: { event: 'The Spring - The WAK - TUC Event', tier: tierKey },
    });
    return jsonOk(res, { url: session.url });
  } catch (err) {
    console.error('[tickets:buy]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: reserve — save a card for RM0, charge it later via Invoice ──
async function actionReserve(req, res) {
  const tierKey = String(req.body?.tier || '').toLowerCase();
  const tier = TIERS[tierKey];
  if (!tier) return jsonErr(res, 400, `tier must be one of ${Object.keys(TIERS).join(', ')}`);

  const priceId = process.env[tier.envVar];
  if (!priceId) return jsonErr(res, 500, `${tier.envVar} not set — run npm run setup-tickets first`);

  const origin = getOrigin(req);

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      payment_method_types: ['card'],
      // Required — setup mode does NOT create a Customer by default the way
      // payment mode sometimes does. Without this, session.customer would be
      // null and the later Invoice-based charge would have nothing to bill.
      customer_creation: 'always',
      metadata: { event: 'The Spring - The WAK - TUC Event', tier: tierKey, type: 'reservation' },
      success_url: `${origin}/reservation-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/tickets.html?status=cancelled`,
    });
    return jsonOk(res, { url: session.url });
  } catch (err) {
    console.error('[tickets:reserve]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: confirm — called by reservation-confirmed.html on load; verifies
// the setup actually completed server-side (the redirect alone isn't proof)
// and logs one row to the Reservations sheet ──
async function actionConfirm(req, res) {
  const sessionId = String(req.body?.session_id || '');
  if (!sessionId) return jsonErr(res, 400, 'session_id required');

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['setup_intent'],
    });
    if (session.status !== 'complete') {
      return jsonErr(res, 400, 'This reservation was not completed.');
    }
    const tierKey = session.metadata?.tier;
    const tier = TIERS[tierKey];
    if (!tier) return jsonErr(res, 400, 'Could not determine ticket type for this reservation.');

    const setupIntent = session.setup_intent;
    const paymentMethodId = typeof setupIntent?.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent?.payment_method?.id;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const email = session.customer_details?.email || '';

    if (!paymentMethodId || !customerId) {
      return jsonErr(res, 400, 'Reservation is missing payment details — please contact support.');
    }

    const { sheetsGetValues, sheetsAppendRow } = require('./_google');

    // Idempotent — reloading the confirmation page shouldn't log a duplicate row.
    const existing = await sheetsGetValues({ spreadsheetId, range: RESERVATIONS_SHEET_RANGE_ALL });
    const already = existing.some(r => r[0] === sessionId);
    if (!already) {
      await sheetsAppendRow({
        spreadsheetId, range: RESERVATIONS_SHEET_RANGE_APPEND,
        values: [sessionId, email, tierKey, customerId, paymentMethodId, 'Reserved', new Date().toISOString(), '', ''],
      });
    }

    return jsonOk(res, {
      success: true, tier: tierKey, tierLabel: tier.label, email,
      chargeDate: '7 October 2026', // TEST VALUE, change back to 20 October before real launch
    });
  } catch (err) {
    console.error('[tickets:confirm]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── GET (cron only) — charges every still-"Reserved" row once the cutoff has
// passed. Verified via CRON_SECRET so this can't be triggered by anyone who
// just finds the URL (that would let someone force-charge reservations early).
async function actionCharge(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return jsonErr(res, 401, 'Unauthorized');
  }

  if (new Date() < RESERVATION_CUTOFF) {
    return jsonOk(res, { success: true, message: 'Cutoff not reached yet — nothing to charge.' });
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const stripe = getStripe();
    const { sheetsGetValues, sheetsUpdateRange } = require('./_google');
    const rows = await sheetsGetValues({ spreadsheetId, range: RESERVATIONS_SHEET_RANGE_ALL });

    const results = [];
    for (let i = 0; i < rows.length; i++) {
      const [, email, tierKey, customerId, paymentMethodId, status] = rows[i];
      if (status !== 'Reserved') continue;
      const rowNum = i + 2; // header is row 1

      const tier = TIERS[tierKey];
      const priceId = tier ? process.env[tier.envVar] : null;

      try {
        if (!priceId) throw new Error(`Unknown tier "${tierKey}" or price not configured`);

        await stripe.invoiceItems.create({ customer: customerId, price: priceId });
        const invoice = await stripe.invoices.create({
          customer: customerId,
          collection_method: 'charge_automatically',
          default_payment_method: paymentMethodId,
          metadata: { event: 'The Spring - The WAK - TUC Event', tier: tierKey, type: 'reservation-charge' },
        });
        const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
        // finalizeInvoice already attempts payment when collection_method is
        // charge_automatically; this call is a safety net in case it didn't.
        const paid = finalized.status === 'paid' ? finalized : await stripe.invoices.pay(finalized.id);

        await sheetsUpdateRange({ spreadsheetId, range: `Reservations!F${rowNum}`, values: ['Charged'] });
        await sheetsUpdateRange({ spreadsheetId, range: `Reservations!H${rowNum}`, values: [new Date().toISOString()] });
        results.push({ email, tier: tierKey, status: 'charged', invoiceId: paid.id });
      } catch (err) {
        console.error('[tickets:charge] row', rowNum, err);
        await sheetsUpdateRange({ spreadsheetId, range: `Reservations!F${rowNum}`, values: ['Failed'] }).catch(() => {});
        await sheetsUpdateRange({ spreadsheetId, range: `Reservations!I${rowNum}`, values: [err.message] }).catch(() => {});
        results.push({ email, tier: tierKey, status: 'failed', error: err.message });
      }
    }

    return jsonOk(res, { success: true, processed: results.length, results });
  } catch (err) {
    console.error('[tickets:charge]', err);
    return jsonErr(res, 500, err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return actionCharge(req, res);
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const action = req.body?.action || 'buy';
  switch (action) {
    case 'buy':     return actionBuy(req, res);
    case 'reserve': return actionReserve(req, res);
    case 'confirm': return actionConfirm(req, res);
    default:        return jsonErr(res, 400, `unknown action: ${action}`);
  }
};
