const { PublicKey } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const { getConnection, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

// Pilot token 1 — the original 0-decimal TUC, event 1. Untouched, historical.
const TUC_MINT = new PublicKey('2hgWyBDWgw4xesu8NpwTAhHgy2gnAo5iBhsBNSasngRj');

async function tokenStats(connection, mint) {
  const supplyRes = await connection.getTokenSupply(mint, 'confirmed');
  const totalSupply = supplyRes.value.uiAmount ?? 0;

  // Holder count — every token account for this mint with a positive balance.
  // dataSlice keeps the RPC payload light: only the 8-byte amount field
  // (offset 64 in a Token-2022 account) is fetched, not full account data.
  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
    dataSlice: { offset: 64, length: 8 },
  });
  const holders = accounts.filter(a => a.account.data.readBigUInt64LE(0) > 0n).length;

  return { mint: mint.toBase58(), totalSupply, holders };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return jsonErr(res, 405, 'GET only');

  try {
    const connection = getConnection();
    const wtucMint = getMintPublicKey(); // pilot token 2 — TOKEN_MINT env

    const [tuc, wtuc] = await Promise.all([
      tokenStats(connection, TUC_MINT),
      tokenStats(connection, wtucMint),
    ]);

    return jsonOk(res, { tuc, wtuc });
  } catch (err) {
    console.error('[tokenomics]', err);
    return jsonErr(res, 500, err.message);
  }
};
