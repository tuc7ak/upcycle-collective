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

const DEPOSITS_SHEET_RANGE_ALL    = 'Deposits!A2:G';
const DEPOSITS_SHEET_RANGE_APPEND = 'Deposits!A:G';
// Columns: A session_id | B email | C tier | D amount_paid | E paid_at | F checked_in | G code

const REGISTRATIONS_SHEET_RANGE_APPEND = 'Registrations!A:I';
// Columns: A timestamp | B name | C email | D contact | E tier | F mode (buy/reserve)
//          G date | H workshops | I session_id
// Logged at form-submit time, before Stripe runs — captures everyone who
// completed the workshop-selection form, successful payment or not.

// Same alphabet as the donate flow's codes — no 0/O/1/I, clear to hand-write
// or read aloud at the door.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
function generateCode() {
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(secretKey);
}

function getOrigin(req) {
  return process.env.PUBLIC_SITE_URL || req.headers.origin || `https://${req.headers.host}`;
}

// ── action: register — called by workshop-selection.html after the buyer
// fills in name/email/contact and their date/workshop choice. Logs the
// attempt to the Registrations sheet, then creates the matching Stripe
// Checkout Session (full price for 'buy', 50% deposit for 'reserve').
// Replaces the old separate actionBuy/actionReserve — every purchase now
// goes through this one form first, no more direct Buy/Reserve-to-Stripe.
async function actionRegister(req, res) {
  const { mode, tier: rawTier, name, email, contact, date, workshops } = req.body || {};
  if (!name || !email || !contact) return jsonErr(res, 400, 'name, email and contact are required');
  if (mode !== 'buy' && mode !== 'reserve') return jsonErr(res, 400, 'mode must be buy or reserve');

  const tierKey = String(rawTier || '').toLowerCase();
  const tierMap = mode === 'reserve' ? DEPOSIT_TIERS : TIERS;
  const tier = tierMap[tierKey];
  if (!tier) return jsonErr(res, 400, `tier must be one of ${Object.keys(tierMap).join(', ')}`);

  const priceId = process.env[tier.envVar];
  if (!priceId) return jsonErr(res, 500, `${tier.envVar} not set — run npm run setup-${mode === 'reserve' ? 'deposits' : 'tickets'} first`);

  const origin = getOrigin(req);
  const workshopsStr = Array.isArray(workshops) ? workshops.join(' | ') : String(workshops || '');

  try {
    const stripe = getStripe();
    const sessionParams = {
      mode: 'payment',
      // fpx temporarily disabled — not activated on the live Stripe account
      // yet (likely needs a Business Registration Number TUC doesn't have as
      // an unregistered entity). Re-add 'fpx' here once it's enabled live.
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        event: 'The Spring - The WAK - TUC Event', tier: tierKey,
        // type: 'deposit' is what the Make.com filter excludes, alongside
        // the existing payment_status = paid check — otherwise a deposit
        // would also trigger the full-purchase branded email.
        type: mode === 'reserve' ? 'deposit' : 'full',
        name, contact, date: String(date || ''), workshops: workshopsStr,
      },
    };
    if (mode === 'reserve') {
      sessionParams.success_url = `${origin}/reservation-confirmed.html?session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url  = `${origin}/tickets.html?status=cancelled`;
    } else {
      sessionParams.success_url = `${origin}/tickets.html?status=success&session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url  = `${origin}/tickets.html?status=cancelled`;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Best-effort — this is a convenience log of registration attempts, the
    // Stripe session itself (with the same data in metadata) is the real
    // record, so a Sheet failure shouldn't block checkout.
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (spreadsheetId) {
      try {
        const { sheetsAppendRow } = require('./_google');
        await sheetsAppendRow({
          spreadsheetId, range: REGISTRATIONS_SHEET_RANGE_APPEND,
          // Contact is prefixed with ' — Sheets' USER_ENTERED mode otherwise
          // parses a phone number as a plain number and silently drops the
          // leading 0 (confirmed: "0123456789" became "123456789").
          values: [new Date().toISOString(), name, email, `'${contact}`, tierKey, mode, String(date || ''), workshopsStr, session.id],
        });
      } catch (sheetErr) {
        console.error('[tickets:register] sheet append failed', sheetErr);
      }
    }

    return jsonOk(res, { url: session.url });
  } catch (err) {
    console.error('[tickets:register]', err);
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

    // Idempotent — reloading the confirmation page shouldn't log a duplicate
    // row or send a second email. Re-uses the SAME code on a reload, since
    // the code is only generated the first time this session is confirmed.
    const existing = await sheetsGetValues({ spreadsheetId, range: DEPOSITS_SHEET_RANGE_ALL });
    const existingRow = existing.find(r => r[0] === sessionId);
    let code = existingRow?.[6];

    if (!existingRow) {
      code = generateCode();
      await sheetsAppendRow({
        spreadsheetId, range: DEPOSITS_SHEET_RANGE_APPEND,
        values: [sessionId, email, tierKey, amountPaid, new Date().toISOString(), '', code],
      });

      // Best-effort — the Sheet row above is the real record; email delivery
      // failing shouldn't fail this confirmation (the code is still shown
      // on-screen right after this call either way).
      if (email) {
        try {
          const { sendEmail } = require('./_resend');
          await sendEmail({
            to: email,
            subject: 'Your TUC Reservation Code',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background-color: #FFFDF4; border: 2px solid #163B24; border-radius: 16px;">
                <h2 style="color: #163B24; margin-top: 0;">You're reserved!</h2>
                <p style="color: #163B24; font-size: 15px; line-height: 1.6;">
                  Your <strong>${tier.label}</strong> deposit of RM${amountPaid.toFixed(2)} has been received (non-refundable).
                </p>
                <div style="background-color: #DDF6C8; border: 1.5px dashed #163B24; border-radius: 12px; padding: 16px; text-align: center; margin: 20px 0;">
                  <p style="color: #163B24; font-size: 13px; font-weight: bold; margin: 0 0 6px;">YOUR CODE</p>
                  <p style="color: #163B24; font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 0;">${code}</p>
                </div>
                <p style="color: #163B24; font-size: 15px; line-height: 1.6;">
                  Present this code at the registration counter on event day, along with the remaining 50% in cash, to receive your ticket.
                </p>
                <p style="color: rgba(22,59,36,0.6); font-size: 12px; margin-top: 24px;">
                  Questions? Reply to this email or contact tucswk@gmail.com.
                </p>
              </div>
            `,
            replyTo: 'tucswk@gmail.com',
          });
        } catch (emailErr) {
          console.error('[tickets:confirm] email send failed', emailErr);
        }
      }
    }

    return jsonOk(res, {
      success: true, tier: tierKey, tierLabel: tier.label, email, amountPaid, code,
    });
  } catch (err) {
    console.error('[tickets:confirm]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: debug-sheet-read — one-time admin helper to verify the
// Registrations tab exists and logged correctly. Remove once used.
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
    const rows = await sheetsGetValues({ spreadsheetId, range: 'Registrations!A1:I10' });
    return jsonOk(res, { success: true, rows });
  } catch (err) {
    console.error('[tickets:debug-sheet-read]', err);
    return jsonErr(res, 500, err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const action = req.body?.action || 'register';
  switch (action) {
    case 'register': return actionRegister(req, res);
    case 'confirm':  return actionConfirm(req, res);
    case 'debug-sheet-read': return actionDebugSheetRead(req, res);
    default:         return jsonErr(res, 400, `unknown action: ${action}`);
  }
};
