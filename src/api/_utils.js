const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');

function getConnection() {
  const rpc = process.env.HELIUS_RPC || 'https://api.devnet.solana.com';
  return new Connection(rpc, 'confirmed');
}

function getOrganiser() {
  const key = process.env.ORGANISER_PRIVATE_KEY;
  if (!key) throw new Error('ORGANISER_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(key));
}

function getMintPublicKey() {
  const mint = process.env.TOKEN_MINT;
  if (!mint) throw new Error('TOKEN_MINT not set');
  return new PublicKey(mint);
}

function jsonOk(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(data);
}

function jsonErr(res, code, message) {
  res.setHeader('Content-Type', 'application/json');
  res.status(code).json({ error: message });
}

module.exports = { getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr };
