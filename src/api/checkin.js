const { PublicKey, Transaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr, MEMO_PREFIX, toRawAmount } = require('./_utils');
const bs58 = require('bs58');

const CHECKIN_AMOUNT = 50; // UI amount (wTUC) — scaled to raw base units via toRawAmount() at mint time
const CHECKIN_MEMO   = `${MEMO_PREFIX}:CHECKIN`;
const MEMO_PROGRAM   = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const WINDOW_SECS    = 86400; // 24 hours

module.exports = async function handler(req, res) {

  // ── GET — Solana Pay label/icon ─────────────────────────────────────────
  if (req.method === 'GET') {
    return jsonOk(res, {
      label: 'wTUC Check-in — The Upcycle Collective',
      icon:  'https://upcycle-collective.vercel.app/tuc-logo.png',
    });
  }

  if (req.method !== 'POST') return jsonErr(res, 405, 'GET or POST only');

  // ── POST — build mint transaction ────────────────────────────────────────
  const { account } = req.body ?? {};
  if (!account) return jsonErr(res, 400, 'account required');

  let attendeePubkey;
  try { attendeePubkey = new PublicKey(account); } catch {
    return jsonErr(res, 400, 'invalid wallet address');
  }

  try {
    const connection  = getConnection();
    const organiser   = getOrganiser();
    const mint        = getMintPublicKey();
    const attendeeATA = getAssociatedTokenAddressSync(mint, attendeePubkey, false, TOKEN_2022_PROGRAM_ID);

    // ── 24-hour duplicate check ─────────────────────────────────────────
    const cutoff   = Math.floor(Date.now() / 1000) - WINDOW_SECS;
    let alreadyIn  = false;

    try {
      const sigs = await connection.getSignaturesForAddress(attendeeATA, { limit: 20 }, 'confirmed');
      for (const sig of sigs) {
        // Only skip if blockTime is confirmed older than 24h — null means very recent, still check it
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
          let memo = '';
          if (ix.parsed && typeof ix.parsed === 'string') memo = ix.parsed.trim();
          else if (ix.data) {
            try { memo = Buffer.from(bs58.decode(ix.data)).toString('utf8').trim(); } catch {}
          }
          if (memo.includes('CHECKIN')) { alreadyIn = true; break; }
        }
        if (alreadyIn) break;
      }
    } catch { /* ATA may not exist yet — first check-in */ }

    if (alreadyIn) {
      return jsonErr(res, 429, 'Already checked in today.');
    }

    // ── Build mint transaction ──────────────────────────────────────────
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: organiser.publicKey, blockhash, lastValidBlockHeight });

    // Create ATA if first-time wallet
    try {
      await getAccount(connection, attendeeATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(
        organiser.publicKey, attendeeATA, attendeePubkey, mint, TOKEN_2022_PROGRAM_ID,
      ));
    }

    tx.add(createMintToInstruction(mint, attendeeATA, organiser.publicKey, toRawAmount(CHECKIN_AMOUNT), [], TOKEN_2022_PROGRAM_ID));

    // Attendee as co-signer on memo so Solflare shows the approval screen
    tx.add(createMemoInstruction(CHECKIN_MEMO, [organiser.publicKey, attendeePubkey]));

    tx.partialSign(organiser);

    const serialised = tx.serialize({ requireAllSignatures: false });
    return jsonOk(res, {
      transaction: Buffer.from(serialised).toString('base64'),
      message: `Welcome! You've received ${CHECKIN_AMOUNT} wTUC tokens.`,
    });

  } catch (err) {
    console.error('[checkin]', err);
    return jsonErr(res, 500, err.message);
  }
};
