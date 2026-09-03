const { PublicKey, Transaction } = require('@solana/web3.js');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, jsonOk, jsonErr, MEMO_PREFIX } = require('./_utils');
const bs58 = require('bs58');

// Check-in is memo-only — no tokens are minted here. It just records that
// this wallet showed up, once per Malaysia Time calendar day.
const CHECKIN_MEMO   = `${MEMO_PREFIX}:CHECKIN`;
const MEMO_PROGRAM   = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MYT_OFFSET_SECS = 8 * 3600; // Malaysia Time = UTC+8, no DST

// Start of "today" in MYT, expressed as a UTC unix timestamp — e.g. checking
// in at 11pm MYT and again at 1am MYT the next day is two different calendar
// days (only 2 hours apart), so the second check-in is allowed. This resets
// at midnight MYT regardless of when the last check-in happened, unlike a
// rolling 24h window.
function mytMidnightCutoff() {
  const nowSecs = Math.floor(Date.now() / 1000);
  return Math.floor((nowSecs + MYT_OFFSET_SECS) / 86400) * 86400 - MYT_OFFSET_SECS;
}

function vendorSlug(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

module.exports = async function handler(req, res) {
  // ?vendor=POUCH turns this into a vendor-visit stamp instead of the
  // attendee check-in — same memo-only mechanism, different tag, and no
  // once-per-day limit (visiting a vendor booth more than once is fine).
  const vendor     = vendorSlug(req.query?.vendor);
  const isVendor   = !!vendor;
  const memo       = isVendor ? `${MEMO_PREFIX}:VENDOR:${vendor}` : CHECKIN_MEMO;
  const vendorName = isVendor ? req.query.vendor : null;

  // ── GET — Solana Pay label/icon ─────────────────────────────────────────
  if (req.method === 'GET') {
    return jsonOk(res, {
      label: isVendor ? `${vendorName} — The Upcycle Collective` : 'wTUC Check-in — The Upcycle Collective',
      icon:  'https://upcycle-collective.vercel.app/tuc-logo.png',
    });
  }

  if (req.method !== 'POST') return jsonErr(res, 405, 'GET or POST only');

  // ── POST — build memo transaction ────────────────────────────────────────
  const { account } = req.body ?? {};
  if (!account) return jsonErr(res, 400, 'account required');

  let attendeePubkey;
  try { attendeePubkey = new PublicKey(account); } catch {
    return jsonErr(res, 400, 'invalid wallet address');
  }

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();

    // ── Once-per-MYT-calendar-day duplicate check (attendee check-in only) ──
    if (!isVendor) {
      const cutoff  = mytMidnightCutoff();
      let alreadyIn = false;

      try {
        const sigs = await connection.getSignaturesForAddress(attendeePubkey, { limit: 20 }, 'confirmed');
        for (const sig of sigs) {
          // Only skip once blockTime is confirmed before today's MYT cutoff —
          // null means very recent, still check it
          if (sig.blockTime !== null && sig.blockTime < cutoff) break;
          let tx = null;
          try {
            tx = await connection.getParsedTransaction(
              sig.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }
            );
          } catch { continue; }
          if (!tx) continue;
          const allIx = [
            ...(tx.transaction?.message?.instructions ?? []),
            ...(tx.meta?.innerInstructions ?? []).flatMap(ii => ii?.instructions ?? []),
          ].filter(Boolean);
          for (const ix of allIx) {
            const pid = typeof ix.programId === 'string'
              ? ix.programId
              : (ix.programId?.toBase58?.() ?? ix.program ?? '');
            if (pid !== MEMO_PROGRAM) continue;
            let ixMemo = '';
            if (ix.parsed && typeof ix.parsed === 'string') ixMemo = ix.parsed.trim();
            else if (ix.data) {
              try { ixMemo = Buffer.from(bs58.decode(ix.data)).toString('utf8').trim(); } catch {}
            }
            if (ixMemo.includes('CHECKIN')) { alreadyIn = true; break; }
          }
          if (alreadyIn) break;
        }
      } catch { /* first-ever check-in for this wallet — no history yet */ }

      if (alreadyIn) {
        return jsonErr(res, 429, 'Already checked in today.');
      }
    }

    // ── Build memo-only transaction ──────────────────────────────────────
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: organiser.publicKey, blockhash, lastValidBlockHeight });

    // Attendee as co-signer on memo so their wallet shows the approval screen
    tx.add(createMemoInstruction(memo, [organiser.publicKey, attendeePubkey]));

    tx.partialSign(organiser);

    const serialised = tx.serialize({ requireAllSignatures: false });
    return jsonOk(res, {
      transaction: Buffer.from(serialised).toString('base64'),
      message: isVendor ? `Checked in at ${vendorName}!` : `Welcome! You're checked in.`,
    });

  } catch (err) {
    console.error('[checkin]', err);
    return jsonErr(res, 500, err.message);
  }
};
