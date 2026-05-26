const { PublicKey } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} = require('@solana/spl-token');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

const CHECKIN_AMOUNT = 50;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { wallet } = req.body ?? {};
  if (!wallet) return jsonErr(res, 400, 'wallet address required');

  let attendeePubkey;
  try {
    attendeePubkey = new PublicKey(wallet);
  } catch {
    return jsonErr(res, 400, 'invalid wallet address');
  }

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();
    const mint       = getMintPublicKey();

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      organiser,
      mint,
      attendeePubkey,
      false,
      'confirmed',
      {},
      TOKEN_2022_PROGRAM_ID,
    );

    const signature = await mintTo(
      connection,
      organiser,
      mint,
      tokenAccount.address,
      organiser,
      CHECKIN_AMOUNT,
      [],
      {},
      TOKEN_2022_PROGRAM_ID,
    );

    return jsonOk(res, {
      success: true,
      wallet,
      tokensAwarded: CHECKIN_AMOUNT,
      tokenAccount: tokenAccount.address.toBase58(),
      signature,
    });
  } catch (err) {
    console.error('[checkin]', err);
    return jsonErr(res, 500, err.message);
  }
};
