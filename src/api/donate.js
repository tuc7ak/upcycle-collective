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
    // never needs the donor's wallet to approve anything. The donor's
    // address goes in the memo text itself rather than as an extra account
    // key on the instruction — attaching accounts after the instruction is
    // built trips Solana's signer-bucket compilation.
    const tx = new Transaction().add(
      createMemoInstruction(`TUC:DONATE:${type}:${kg}KG:${donorPubkey.toBase58()}`, [organiser.publicKey]),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);

    return jsonOk(res, { success: true, wallet, type, kg, signature });
  } catch (err) {
    console.error('[donate]', err);
    return jsonErr(res, 500, err.message);
  }
};
