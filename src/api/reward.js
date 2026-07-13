const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

const MAX_MANUAL_REWARD = 200;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { wallet, amount: rawAmount } = req.body ?? {};
  if (!wallet) return jsonErr(res, 400, 'wallet required');

  const amount = parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_MANUAL_REWARD) {
    return jsonErr(res, 400, `amount must be a whole number between 1 and ${MAX_MANUAL_REWARD}`);
  }

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
      connection, organiser, mint, attendeePubkey, false, 'confirmed', {}, TOKEN_2022_PROGRAM_ID,
    );

    const tx = new Transaction()
      .add(createMintToInstruction(mint, tokenAccount.address, organiser.publicKey, amount, [], TOKEN_2022_PROGRAM_ID))
      .add(createMemoInstruction('TUC:CREW_REWARD', [organiser.publicKey]));

    const signature = await sendAndConfirmTransaction(connection, tx, [organiser]);

    return jsonOk(res, { success: true, wallet, tokensAwarded: amount, signature });
  } catch (err) {
    console.error('[reward]', err);
    return jsonErr(res, 500, err.message);
  }
};
