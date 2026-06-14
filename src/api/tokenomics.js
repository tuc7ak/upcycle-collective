const { PublicKey } = require('@solana/web3.js');
const { getConnection, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return jsonErr(res, 405, 'GET only');

  try {
    const connection = getConnection();
    const mint       = getMintPublicKey();

    // Total supply
    const supplyRes = await connection.getTokenSupply(mint, 'confirmed');
    const totalSupply = supplyRes.value.uiAmount ?? 0;

    // Top 20 token accounts by balance
    const largest = await connection.getTokenLargestAccounts(mint, 'confirmed');
    const top = largest.value.slice(0, 10);

    // Fetch owner (wallet address) for each token account
    const infos = await connection.getMultipleParsedAccounts(
      top.map(a => new PublicKey(a.address)),
      { commitment: 'confirmed' },
    );

    const holders = top.map((acct, i) => {
      const parsed = infos.value[i]?.data?.parsed?.info;
      const wallet = parsed?.owner ?? null;
      const amount = acct.uiAmount ?? 0;
      return {
        rank: i + 1,
        tokenAccount: acct.address.toBase58(),
        walletAddress: wallet,
        amount,
        pct: totalSupply > 0 ? ((amount / totalSupply) * 100).toFixed(2) : '0.00',
      };
    });

    return jsonOk(res, { totalSupply, holders });
  } catch (err) {
    console.error('[tokenomics]', err);
    return jsonErr(res, 500, err.message);
  }
};
