const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');
const { sheetsGetValues, sheetsUpdateRange } = require('./_google');
const bs58 = require('bs58');

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
// Organiser signs every memo/mint tx at the event (check-ins, rewards, vendor
// pays, donations), so a code issued a while ago can scroll past a small
// window. 150 keeps each validation call comfortably inside a serverless
// function's time budget while covering normal drop-off turnaround.
const SCAN_LIMIT = 150;

function parseMemo(ix) {
  const pid = typeof ix.programId === 'string' ? ix.programId : ix.programId?.toBase58?.();
  if (pid !== MEMO_PROGRAM) return null;
  if (ix.parsed && typeof ix.parsed === 'string') return ix.parsed;
  if (ix.data) {
    try { return Buffer.from(bs58.decode(ix.data)).toString('utf8'); } catch { return null; }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

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

    // Newest-first scan: a VALIDATED memo is always more recent than its
    // matching CODE memo, so hitting one first is proof enough either way.
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
          const parts = memo.split(':'); // TUC, DONATE, CODE, code, TYPE, wallet
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

    // Best-effort — the on-chain memo above is the real record of payment;
    // the Sheet is just a convenience log, so a failure here shouldn't
    // block a donor who already got their tokens.
    if (process.env.GOOGLE_SHEET_ID) {
      try {
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const rows = await sheetsGetValues({ spreadsheetId, range: 'A2:A' });
        const idx = rows.findIndex(r => (r[0] || '').toUpperCase() === code);
        if (idx !== -1) {
          await sheetsUpdateRange({ spreadsheetId, range: `F${idx + 2}`, values: ['validated'] });
        }
      } catch (sheetErr) {
        console.error('[donate-validate] sheet update failed', sheetErr);
      }
    }

    return jsonOk(res, {
      success: true, code, wallet: issued.wallet, type: issued.type, kg, tokensAwarded: tokens, signature,
    });
  } catch (err) {
    console.error('[donate-validate]', err);
    return jsonErr(res, 500, err.message);
  }
};
