const { PublicKey } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  mintTo,
} = require('@solana/spl-token');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

const REWARDS = {
  recycle_bag: 10,
  trivia_easy: 5,
  trivia_hard: 10,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { wallet, reward } = req.body ?? {};
  if (!wallet) return jsonErr(res, 400, 'wallet required');
  if (!reward) return jsonErr(res, 400, 'reward type required');

  const amount = REWARDS[reward];
  if (!amount) return jsonErr(res, 400, `unknown reward. Valid: ${Object.keys(REWARDS).join(', ')}`);

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

    const tokenAccount = getAssociatedTokenAddressSync(
      mint, attendeePubkey, false, TOKEN_2022_PROGRAM_ID,
    );

    const signature = await mintTo(
      connection, organiser, mint, tokenAccount, organiser, amount, [], {}, TOKEN_2022_PROGRAM_ID,
    );

    return jsonOk(res, { success: true, wallet, reward, tokensAwarded: amount, signature });
  } catch (err) {
    console.error('[reward]', err);
    return jsonErr(res, 500, err.message);
  }
};
