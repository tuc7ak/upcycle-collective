const Stripe = require('stripe');
const { jsonOk, jsonErr } = require('./_utils');

// Single dispatcher for ticket purchases AND deposits, kept as one Vercel
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

// 50% deposit tiers — separate Stripe products (scripts/setup-stripe-deposits.mjs),
// deliberately NOT marked as tickets in Lomeo, so no QR auto-issues after just
// the deposit. The remaining 50% is paid in cash at the door on event day —
// no card is saved, no later auto-charge, no cron job needed at all.
const DEPOSIT_TIERS = {
  student: { label: 'Student Ticket — 50% Deposit', envVar: 'STRIPE_PRICE_STUDENT_DEPOSIT' },
  normal:  { label: 'Normal Ticket — 50% Deposit',  envVar: 'STRIPE_PRICE_NORMAL_DEPOSIT' },
  premium: { label: 'Premium Ticket — 50% Deposit', envVar: 'STRIPE_PRICE_PREMIUM_DEPOSIT' },
};

const DEPOSITS_SHEET_RANGE_ALL    = 'Deposits!A2:F';
const DEPOSITS_SHEET_RANGE_APPEND = 'Deposits!A:F';
// Columns: A session_id | B email | C tier | D amount_paid | E paid_at | F checked_in

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(secretKey);
}

function getOrigin(req) {
  return process.env.PUBLIC_SITE_URL || req.headers.origin || `https://${req.headers.host}`;
}

// ── action: buy (default) — existing one-time full-price ticket purchase ──
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
      metadata: { event: 'The Spring - The WAK - TUC Event', tier: tierKey, type: 'full' },
    });
    return jsonOk(res, { url: session.url });
  } catch (err) {
    console.error('[tickets:buy]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: reserve — pay a 50% deposit now, real card charge (not RM0),
// non-refundable; the remaining 50% is cash at the door on event day. No
// Lomeo ticket, no Make.com purchase email — deliberately silent beyond
// Stripe's own payment receipt, since the real ticket only exists once the
// door staff collect the balance and check this person in.
async function actionReserve(req, res) {
  const tierKey = String(req.body?.tier || '').toLowerCase();
  const tier = DEPOSIT_TIERS[tierKey];
  if (!tier) return jsonErr(res, 400, `tier must be one of ${Object.keys(DEPOSIT_TIERS).join(', ')}`);

  const priceId = process.env[tier.envVar];
  if (!priceId) return jsonErr(res, 500, `${tier.envVar} not set — run npm run setup-deposits first`);

  const origin = getOrigin(req);

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/reservation-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/tickets.html?status=cancelled`,
      // type: 'deposit' is what your Make.com filter should exclude, in
      // addition to the existing payment_status = paid check — otherwise a
      // deposit would also trigger the full-purchase branded email.
      metadata: { event: 'The Spring - The WAK - TUC Event', tier: tierKey, type: 'deposit' },
    });
    return jsonOk(res, { url: session.url });
  } catch (err) {
    console.error('[tickets:reserve]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: confirm — called by reservation-confirmed.html on load; verifies
// the deposit payment actually completed server-side and logs one row to the
// Deposits sheet for door staff to check against on event day ──
async function actionConfirm(req, res) {
  const sessionId = String(req.body?.session_id || '');
  if (!sessionId) return jsonErr(res, 400, 'session_id required');

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return jsonErr(res, 400, 'This deposit payment was not completed.');
    }
    const tierKey = session.metadata?.tier;
    const tier = DEPOSIT_TIERS[tierKey];
    if (!tier) return jsonErr(res, 400, 'Could not determine ticket type for this deposit.');

    const email = session.customer_details?.email || '';
    const amountPaid = (session.amount_total || 0) / 100;

    const { sheetsGetValues, sheetsAppendRow } = require('./_google');

    // Idempotent — reloading the confirmation page shouldn't log a duplicate row.
    const existing = await sheetsGetValues({ spreadsheetId, range: DEPOSITS_SHEET_RANGE_ALL });
    const already = existing.some(r => r[0] === sessionId);
    if (!already) {
      await sheetsAppendRow({
        spreadsheetId, range: DEPOSITS_SHEET_RANGE_APPEND,
        values: [sessionId, email, tierKey, amountPaid, new Date().toISOString(), ''],
      });
    }

    return jsonOk(res, {
      success: true, tier: tierKey, tierLabel: tier.label, email, amountPaid,
    });
  } catch (err) {
    console.error('[tickets:confirm]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: debug-sheet-read — one-time admin helper to verify the Deposits
// tab exists with the right header. Remove once used.
async function actionDebugSheetRead(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.ADMIN_SECRET || ''}`;
  if (!process.env.ADMIN_SECRET || authHeader !== expected) {
    return jsonErr(res, 401, 'Unauthorized');
  }
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');
  try {
    const { sheetsGetValues } = require('./_google');
    const rows = await sheetsGetValues({ spreadsheetId, range: 'Deposits!A1:F10' });
    return jsonOk(res, { success: true, rows });
  } catch (err) {
    console.error('[tickets:debug-sheet-read]', err);
    return jsonErr(res, 500, err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const action = req.body?.action || 'buy';
  switch (action) {
    case 'buy':     return actionBuy(req, res);
    case 'reserve': return actionReserve(req, res);
    case 'confirm': return actionConfirm(req, res);
    case 'debug-sheet-read': return actionDebugSheetRead(req, res);
    default:        return jsonErr(res, 400, `unknown action: ${action}`);
  }
};
