const { PublicKey, Transaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('../_utils');

const VENDOR_LABEL   = 'BEER_STALL';
const TOKEN_COST     = 1;
const TOKEN_DECIMALS = 0;

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return jsonOk(res, {
      label: 'Upcycle Collective — Beer Stall',
      icon: 'https://upcycle-collective.vercel.app/tuc-logo.png',
    });
  }

  if (req.method !== 'POST') return jsonErr(res, 405, 'GET or POST only');

  const { account } = req.body ?? {};
  if (!account) return jsonErr(res, 400, 'account (attendee wallet) required');

  const VENDOR_WALLET = process.env.VENDOR_BEER_STALL;
  if (!VENDOR_WALLET) return jsonErr(res, 500, 'VENDOR_BEER_STALL env var not set');

  let attendeePubkey, vendorPubkey;
  try { attendeePubkey = new PublicKey(account); } catch { return jsonErr(res, 400, 'invalid account address'); }
  try { vendorPubkey   = new PublicKey(VENDOR_WALLET); } catch { return jsonErr(res, 500, 'invalid VENDOR_BEER_STALL address'); }

  try {
    const connection = getConnection();
    const organiser  = getOrganiser();
    const mint       = getMintPublicKey();

    const attendeeATA = getAssociatedTokenAddressSync(mint, attendeePubkey, false, TOKEN_2022_PROGRAM_ID);
    const vendorATA   = getAssociatedTokenAddressSync(mint, vendorPubkey,   false, TOKEN_2022_PROGRAM_ID);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: organiser.publicKey, blockhash, lastValidBlockHeight });

    try {
      await getAccount(connection, vendorATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(
        organiser.publicKey, vendorATA, vendorPubkey, mint, TOKEN_2022_PROGRAM_ID,
      ));
    }

    tx.add(createTransferCheckedInstruction(
      attendeeATA, mint, vendorATA, attendeePubkey, TOKEN_COST, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID,
    ));

    tx.add(createMemoInstruction(`${VENDOR_LABEL}:${TOKEN_COST}TUC`, [organiser.publicKey]));

    tx.partialSign(organiser);

    const serialised = tx.serialize({ requireAllSignatures: false });
    return jsonOk(res, {
      transaction: Buffer.from(serialised).toString('base64'),
      message: `Pay ${TOKEN_COST} TUC — Beer Stall`,
    });
  } catch (err) {
    console.error('[pay/beer-stall]', err);
    return jsonErr(res, 500, err.message);
  }
};
