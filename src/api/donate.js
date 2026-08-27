const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');
const crypto = require('crypto');
const bs58 = require('bs58');

// Single dispatcher for every Donate-tab action, kept as one Vercel function
// (not five) — the Hobby plan caps a deployment at 12 Serverless Functions,
// and this project is already close to that with checkin/reward/transfer/
// tokenomics/vendor-history/vendor-pay endpoints.

const TYPES = ['GENERAL', 'CLOTHES', 'ELECTRONICS', 'PLASTICS', 'PAPER'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — clear to hand-write on a bag
const CODE_LENGTH   = 6;
const CODE_RE       = /^[A-Z2-9]{4,10}$/;
const MEMO_PROGRAM  = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SCAN_LIMIT    = 150;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function parseMemo(ix) {
  const pid = typeof ix.programId === 'string' ? ix.programId : ix.programId?.toBase58?.();
  if (pid !== MEMO_PROGRAM) return null;
  if (ix.parsed && typeof ix.parsed === 'string') return ix.parsed;
  if (ix.data) {
    try { return Buffer.from(bs58.decode(ix.data)).toString('utf8'); } catch { return null; }
  }
  return null;
}

function requireType(rawType, res) {
  const type = String(rawType || '').toUpperCase();
  if (!TYPES.includes(type)) { jsonErr(res, 400, `type must be one of ${TYPES.join(', ')}`); return null; }
  return type;
}

function requireWallet(wallet, res) {
  if (!wallet) { jsonErr(res, 400, 'wallet required'); return null; }
  try { return new PublicKey(wallet); } catch { jsonErr(res, 400, 'invalid wallet address'); return null; }
}

// ── action: log — legacy, staff scans a donor's wallet directly, no code ──
async function actionLog(req, res) {
  const { wallet, type: rawType, kg: rawKg } = req.body ?? {};
  const type = requireType(rawType, res);
  if (!type) return;
  const kg = parseFloat(rawKg);
  if (!Number.isFinite(kg) || kg <= 0) return jsonErr(res, 400, 'kg must be a positive number');
  const donorPubkey = requireWallet(wallet, res);
  if (!donorPubkey) return;

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();
    const tx = new Transaction().add(
      createMemoInstruction(`TUC:DONATE:${type}:${kg}KG:${donorPubkey.toBase58()}`, [organiser.publicKey]),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);
    return jsonOk(res, { success: true, wallet, type, kg, signature });
  } catch (err) {
    console.error('[donate:log]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: code — donor generates a sealed-bag code ──
async function actionCode(req, res) {
  const { wallet, type: rawType } = req.body ?? {};
  const type = requireType(rawType, res);
  if (!type) return;
  const donorPubkey = requireWallet(wallet, res);
  if (!donorPubkey) return;

  const code = generateCode();
  try {
    const connection = getConnection();
    const organiser  = getOrganiser();
    const tx = new Transaction().add(
      createMemoInstruction(`TUC:DONATE:CODE:${code}:${type}:${donorPubkey.toBase58()}`, [organiser.publicKey]),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);
    return jsonOk(res, { success: true, code, wallet, type, signature });
  } catch (err) {
    console.error('[donate:code]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: photo — upload a photo for a code, log it in the Sheet ──
async function actionPhoto(req, res) {
  const { blobUploadPhoto, sheetsGetValues, sheetsAppendRow } = require('./_google');
  const { code: rawCode, wallet, type: rawType, photo } = req.body ?? {};
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return jsonErr(res, 400, 'invalid code');
  const donorPubkey = requireWallet(wallet, res);
  if (!donorPubkey) return;
  const type = requireType(rawType, res);
  if (!type) return;
  if (!photo || !String(photo).startsWith('data:image/')) return jsonErr(res, 400, 'photo required');

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const photoLink = await blobUploadPhoto({ dataUrl: photo, filename: `donations/${code}-${Date.now()}.jpg` });
    const existing = await sheetsGetValues({ spreadsheetId, range: 'A2:A' });
    const batch = existing.length + 1;
    await sheetsAppendRow({
      spreadsheetId, range: 'A:G',
      values: [code, wallet, type, batch, photoLink, 'pending', new Date().toISOString()],
    });

    // Also on-chain — wallet sits before the URL (not last) since readers
    // filter memos by "does this end with my wallet", and a URL always
    // would've won that comparison. The URL itself keeps any colons it has
    // (e.g. "https:") — readers take everything after the wallet field as
    // the link rather than treating ':' as a hard delimiter there.
    const connection = getConnection();
    const organiser  = getOrganiser();
    const tx = new Transaction().add(
      createMemoInstruction(`TUC:DONATE:PHOTO:${code}:${batch}:${donorPubkey.toBase58()}:${photoLink}`, [organiser.publicKey]),
    );
    const photoSig = await sendAndConfirmTransaction(connection, tx, [organiser]);

    return jsonOk(res, { success: true, batch, photoLink, signature: photoSig });
  } catch (err) {
    console.error('[donate:photo]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: lookup — staff checks a code's wallet/photo before validating ──
async function actionLookup(req, res) {
  const { sheetsGetValues } = require('./_google');
  const { code: rawCode } = req.body ?? {};
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return jsonErr(res, 400, 'code required');

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const rows = await sheetsGetValues({ spreadsheetId, range: 'A2:G' });
    const row = rows.find(r => (r[0] || '').toUpperCase() === code);
    if (!row) return jsonErr(res, 404, 'Code not found. Check the label and try again.');
    const [, wallet, type, batch, photoLink, status, timestamp] = row;
    return jsonOk(res, {
      success: true, code, wallet, type,
      batch: batch || null, photoLink: photoLink || null,
      status: status || 'pending', timestamp: timestamp || null,
    });
  } catch (err) {
    console.error('[donate:lookup]', err);
    return jsonErr(res, 500, err.message);
  }
}

// ── action: validate — staff mints tokens for a sealed, dropped-off code ──
async function actionValidate(req, res) {
  const { code: rawCode, kg: rawKg } = req.body ?? {};
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return jsonErr(res, 400, 'code required');
  const kg = parseFloat(rawKg);
  if (!Number.isFinite(kg) || kg <= 0) return jsonErr(res, 400, 'kg must be a positive number');

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();
    const mint       = getMintPublicKey();

    const sigs = await connection.getSignaturesForAddress(organiser.publicKey, { limit: SCAN_LIMIT }, 'confirmed');

    let issued = null;
    for (const s of sigs) {
      const tx = await connection.getParsedTransaction(
        s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      );
      if (!tx) continue;
      const allIx = [
        ...(tx.transaction?.message?.instructions ?? []),
        ...(tx.meta?.innerInstructions ?? []).flatMap(ii => ii?.instructions ?? []),
      ].filter(Boolean);

      for (const ix of allIx) {
        const memo = parseMemo(ix);
        if (!memo) continue;
        if (memo.startsWith(`TUC:DONATE:VALIDATED:${code}:`)) {
          return jsonErr(res, 409, 'This code has already been validated.');
        }
        if (memo.startsWith(`TUC:DONATE:CODE:${code}:`)) {
          const parts = memo.split(':');
          issued = { type: parts[4], wallet: parts[5] };
        }
      }
      if (issued) break;
    }

    if (!issued) return jsonErr(res, 404, 'Code not found. Check the label and try again.');

    let donorPubkey;
    try { donorPubkey = new PublicKey(issued.wallet); } catch {
      return jsonErr(res, 500, 'Code found but its wallet address is invalid.');
    }

    const tokens = Math.max(1, Math.round(kg));
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection, organiser, mint, donorPubkey, false, 'confirmed', {}, TOKEN_2022_PROGRAM_ID,
    );

    const tx = new Transaction()
      .add(createMintToInstruction(mint, tokenAccount.address, organiser.publicKey, tokens, [], TOKEN_2022_PROGRAM_ID))
      .add(createMemoInstruction(`TUC:DONATE:VALIDATED:${code}:${issued.type}:${kg}KG:${issued.wallet}`, [organiser.publicKey]));

    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);

    if (process.env.GOOGLE_SHEET_ID) {
      try {
        const { sheetsGetValues, sheetsUpdateRange } = require('./_google');
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const rows = await sheetsGetValues({ spreadsheetId, range: 'A2:A' });
        const idx = rows.findIndex(r => (r[0] || '').toUpperCase() === code);
        if (idx !== -1) await sheetsUpdateRange({ spreadsheetId, range: `F${idx + 2}`, values: ['validated'] });
      } catch (sheetErr) {
        console.error('[donate:validate] sheet update failed', sheetErr);
      }
    }

    return jsonOk(res, {
      success: true, code, wallet: issued.wallet, type: issued.type, kg, tokensAwarded: tokens, signature,
    });
  } catch (err) {
    console.error('[donate:validate]', err);
    return jsonErr(res, 500, err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');
  const action = req.body?.action || 'log';
  switch (action) {
    case 'log':      return actionLog(req, res);
    case 'code':     return actionCode(req, res);
    case 'photo':    return actionPhoto(req, res);
    case 'lookup':   return actionLookup(req, res);
    case 'validate': return actionValidate(req, res);
    default:         return jsonErr(res, 400, `unknown action: ${action}`);
  }
};
