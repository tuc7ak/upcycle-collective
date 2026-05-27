const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

const REWARDS = {
  recycle_bag: 10,
  beer: 10,
  merchandise: 50,
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

    const tx = new Transaction()
      .add(createMintToInstruction(mint, tokenAccount, organiser.publicKey, amount, [], TOKEN_2022_PROGRAM_ID))
      .add(createMemoInstruction(`TUC:${reward.toUpperCase()}`, [organiser.publicKey]));

    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);

    return jsonOk(res, { success: true, wallet, reward, tokensAwarded: amount, signature });
  } catch (err) {
    console.error('[reward]', err);
    return jsonErr(res, 500, err.message);
  }
};
