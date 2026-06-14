const { PublicKey, Transaction } = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} = require('@solana/spl-token');
const { createMemoInstruction } = require('@solana/spl-memo');
const { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

const TOKEN_DECIMALS = 0;

const VENDORS = {
  'drinks':        { label: 'Drinks',        memo: 'DRINKS',        envKey: 'VENDOR_DRINKS',        defaultCost: 5  },
  'food-booth':    { label: 'Food Booth',    memo: 'FOOD_BOOTH',    envKey: 'VENDOR_FOOD_BOOTH',    defaultCost: 8  },
  'merch':         { label: 'Merch',         memo: 'MERCH',         envKey: 'VENDOR_MERCH',         defaultCost: 15 },
  'vip':           { label: 'VIP Upgrade',   memo: 'VIP_UPGRADE',   envKey: 'VENDOR_VIP',           defaultCost: 30 },
  'game-zone':     { label: 'Game Zone',     memo: 'GAME_ZONE',     envKey: 'VENDOR_GAME_ZONE',     defaultCost: 3  },
  'spice-market':  { label: 'Spice Market',  memo: 'SPICE_MARKET',  envKey: 'VENDOR_SPICE_MARKET',  defaultCost: 10 },
};

function createVendorHandler(vendorId) {
  const vendor = VENDORS[vendorId];
  if (!vendor) throw new Error(`Unknown vendor: ${vendorId}`);

  return async function handler(req, res) {
    if (req.method === 'GET') {
      return jsonOk(res, {
        label: `Upcycle Collective — ${vendor.label}`,
        icon: 'https://upcycle-collective.vercel.app/tuc-logo.png',
      });
    }

    if (req.method !== 'POST') return jsonErr(res, 405, 'GET or POST only');

    const { account } = req.body ?? {};
    if (!account) return jsonErr(res, 400, 'account (attendee wallet) required');

    const VENDOR_WALLET = process.env[vendor.envKey];
    if (!VENDOR_WALLET) return jsonErr(res, 500, `${vendor.envKey} env var not set`);

    const rawAmount = req.query?.amount;
    const cost = rawAmount ? parseInt(rawAmount, 10) : vendor.defaultCost;
    if (!cost || cost < 1) return jsonErr(res, 400, 'invalid amount');

    let attendeePubkey, vendorPubkey;
    try { attendeePubkey = new PublicKey(account); } catch { return jsonErr(res, 400, 'invalid account address'); }
    try { vendorPubkey   = new PublicKey(VENDOR_WALLET); } catch { return jsonErr(res, 500, `invalid ${vendor.envKey} address`); }

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
        attendeeATA, mint, vendorATA, attendeePubkey, cost, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID,
      ));

      tx.add(createMemoInstruction(`TUC:${vendor.memo}:${cost}`, [organiser.publicKey]));

      tx.partialSign(organiser);

      const serialised = tx.serialize({ requireAllSignatures: false });
      return jsonOk(res, {
        transaction: Buffer.from(serialised).toString('base64'),
        message: `Pay ${cost} TUC — ${vendor.label}`,
      });
    } catch (err) {
      console.error(`[pay/${vendorId}]`, err);
      return jsonErr(res, 500, err.message);
    }
  };
}

module.exports = { createVendorHandler, VENDORS };
