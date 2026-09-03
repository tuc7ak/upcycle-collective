const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');

// wTUC — the 2nd-pilot-event token (replaces the original 0-decimal TUC for
// all live app operations; TUC itself is untouched and still exists on-chain
// as event 1's historical record). Single source of truth for the memo tag
// and decimals so every file mints/transfers/labels consistently.
const MEMO_PREFIX     = 'wTUC';
const TOKEN_DECIMALS  = 2;
const TOKEN_SYMBOL    = 'wTUC';

// UI amount (e.g. 5.5) -> raw base-unit amount for mint/transfer instructions
// (e.g. 550). Rounds to the nearest base unit so float error can't produce a
// fractional raw amount the token program would reject.
function toRawAmount(uiAmount) {
  return Math.round(uiAmount * 10 ** TOKEN_DECIMALS);
}

// raw base-unit amount -> UI amount, for error messages / logs that read a
// raw balance directly (getAccount().amount) rather than the RPC's already-
// decimal-adjusted uiAmount field.
function fromRawAmount(rawAmount) {
  return rawAmount / 10 ** TOKEN_DECIMALS;
}

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

module.exports = {
  getConnection, getOrganiser, getMintPublicKey, jsonOk, jsonErr,
  MEMO_PREFIX, TOKEN_DECIMALS, TOKEN_SYMBOL, toRawAmount, fromRawAmount,
};
