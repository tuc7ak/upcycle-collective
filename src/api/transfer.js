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
    const { from, to, amount, memo } = body;
    if (!from)                     return jsonErr(res, 400, 'from required');
    if (!to)                       return jsonErr(res, 400, 'to required');
    if (!amount || amount < 1)     return jsonErr(res, 400, 'amount >= 1 required');

    let fromPubkey, toPubkey;
    try { fromPubkey = new PublicKey(from); } catch { return jsonErr(res, 400, 'invalid from address'); }
    try { toPubkey   = new PublicKey(to);   } catch { return jsonErr(res, 400, 'invalid to address'); }
    if (fromPubkey.equals(toPubkey)) return jsonErr(res, 400, 'cannot send to yourself');

    try {
      const connection = getConnection();
      const organiser  = getOrganiser();
      const mint       = getMintPublicKey();

      const fromATA = getAssociatedTokenAddressSync(mint, fromPubkey, false, TOKEN_2022_PROGRAM_ID);
      const toATA   = getAssociatedTokenAddressSync(mint, toPubkey,   false, TOKEN_2022_PROGRAM_ID);

      // Check sender has TUC and enough balance
      let senderBalance = 0;
      try {
        const senderAccount = await getAccount(connection, fromATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
        senderBalance = Number(senderAccount.amount);
      } catch {
        return jsonErr(res, 400, 'Sender wallet has no TUC tokens — check in at the desk first.');
      }
      if (senderBalance < amount) {
        return jsonErr(res, 400, `Not enough TUC — you have ${senderBalance} but need ${amount}.`);
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: organiser.publicKey, blockhash, lastValidBlockHeight });

      // Create recipient ATA if it doesn't exist yet
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

      // Memo is optional — add only if provided
      if (memo && memo.trim()) {
        const { createMemoInstruction } = require('@solana/spl-memo');
        tx.add(createMemoInstruction(memo.trim(), [organiser.publicKey]));
      }

      // Organiser pre-signs as fee payer — Phantom then adds sender signature
      tx.partialSign(organiser);
      const serialised = tx.serialize({ requireAllSignatures: false });
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

      const txBuf = Buffer.from(transaction, 'base64');
      const tx    = Transaction.from(txBuf);

      // Organiser already signed in build step — just broadcast
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
