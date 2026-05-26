const { PublicKey, Transaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} = require('@solana/spl-token');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

const TOKEN_DECIMALS = 0;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  // Parse body whether it arrives as string or object
  let body = req.body ?? {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return jsonErr(res, 400, 'invalid JSON'); }
  }

  // ── Step 1: build unsigned tx, return for Phantom to sign ─────────────────
  if (body.step === 'build') {
    const { from, to, amount } = body;
    if (!from)          return jsonErr(res, 400, 'from required');
    if (!to)            return jsonErr(res, 400, 'to required');
    if (!amount || amount < 1) return jsonErr(res, 400, 'amount >= 1 required');

    let fromPubkey, toPubkey;
    try { fromPubkey = new PublicKey(from); } catch { return jsonErr(res, 400, 'invalid from'); }
    try { toPubkey   = new PublicKey(to);   } catch { return jsonErr(res, 400, 'invalid to'); }
    if (fromPubkey.equals(toPubkey)) return jsonErr(res, 400, 'cannot send to yourself');

    try {
      const connection = getConnection();
      const organiser  = getOrganiser();
      const mint       = getMintPublicKey();

      const fromATA = getAssociatedTokenAddressSync(mint, fromPubkey, false, TOKEN_2022_PROGRAM_ID);
      const toATA   = getAssociatedTokenAddressSync(mint, toPubkey,   false, TOKEN_2022_PROGRAM_ID);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: organiser.publicKey, blockhash, lastValidBlockHeight });

      try {
        await getAccount(connection, toATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
      } catch {
        tx.add(createAssociatedTokenAccountInstruction(
          organiser.publicKey, toATA, toPubkey, mint, TOKEN_2022_PROGRAM_ID,
        ));
      }

      tx.add(createTransferCheckedInstruction(
        fromATA, mint, toATA, fromPubkey, amount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID,
      ));

      // Return UNSIGNED — Phantom will sign the user instruction
      const serialised = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      return jsonOk(res, { transaction: Buffer.from(serialised).toString('base64') });
    } catch (err) {
      console.error('[transfer/build]', err);
      return jsonErr(res, 500, err.message);
    }
  }

  // ── Step 2: receive Phantom-signed tx, add organiser sig, broadcast ────────
  if (body.step === 'send') {
    const { transaction } = body;
    if (!transaction) return jsonErr(res, 400, 'transaction required');

    try {
      const connection = getConnection();
      const organiser  = getOrganiser();

      const txBuf = Buffer.from(transaction, 'base64');
      const tx    = Transaction.from(txBuf);

      // Organiser signs as fee payer
      tx.partialSign(organiser);

      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, 'confirmed');

      return jsonOk(res, { success: true, signature: sig });
    } catch (err) {
      console.error('[transfer/send]', err);
      return jsonErr(res, 500, err.message);
    }
  }

  return jsonErr(res, 400, 'step must be "build" or "send"');
};
