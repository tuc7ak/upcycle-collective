const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, jsonOk, jsonErr } = require('./_utils');
const crypto = require('crypto');

const TYPES = ['CLOTHES', 'ELECTRONICS', 'PLASTICS', 'PAPER'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — clear to hand-write on a bag
const CODE_LENGTH   = 6;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { wallet, type: rawType } = req.body ?? {};
  if (!wallet) return jsonErr(res, 400, 'wallet required');

  const type = String(rawType || '').toUpperCase();
  if (!TYPES.includes(type)) return jsonErr(res, 400, `type must be one of ${TYPES.join(', ')}`);

  let donorPubkey;
  try {
    donorPubkey = new PublicKey(wallet);
  } catch {
    return jsonErr(res, 400, 'invalid wallet address');
  }

  const code = generateCode();

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();

    // Memo-only, organiser-signed — issues a code that ties this wallet +
    // category to a physical, sealed donation before it's dropped off.
    // Staff looks this record up by code at validation time (donate-validate).
    const tx = new Transaction().add(
      createMemoInstruction(`TUC:DONATE:CODE:${code}:${type}:${donorPubkey.toBase58()}`, [organiser.publicKey]),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);

    return jsonOk(res, { success: true, code, wallet, type, signature });
  } catch (err) {
    console.error('[donate-code]', err);
    return jsonErr(res, 500, err.message);
  }
};
