const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, jsonOk, jsonErr } = require('./_utils');

const TYPES = ['CLOTHES', 'ELECTRONICS', 'PLASTICS', 'PAPER'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { wallet, type: rawType, kg: rawKg } = req.body ?? {};
  if (!wallet) return jsonErr(res, 400, 'wallet required');

  const type = String(rawType || '').toUpperCase();
  if (!TYPES.includes(type)) return jsonErr(res, 400, `type must be one of ${TYPES.join(', ')}`);

  const kg = parseFloat(rawKg);
  if (!Number.isFinite(kg) || kg <= 0) return jsonErr(res, 400, 'kg must be a positive number');

  let donorPubkey;
  try {
    donorPubkey = new PublicKey(wallet);
  } catch {
    return jsonErr(res, 400, 'invalid wallet address');
  }

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();

    // Memo-only — no token movement. Organiser is the sole signer, so this
    // never needs the donor's wallet to approve anything. The donor's pubkey
    // is still attached as a non-signing account so the record surfaces in
    // their own wallet history, not just the organiser's.
    const memoIx = createMemoInstruction(`TUC:DONATE:${type}:${kg}KG`, [organiser.publicKey]);
    memoIx.keys.push({ pubkey: donorPubkey, isSigner: false, isWritable: false });

    const tx = new Transaction().add(memoIx);
    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);

    return jsonOk(res, { success: true, wallet, type, kg, signature });
  } catch (err) {
    console.error('[donate]', err);
    return jsonErr(res, 500, err.message);
  }
};
