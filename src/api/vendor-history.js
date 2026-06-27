const { PublicKey } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const { getConnection, getMintPublicKey, jsonOk, jsonErr } = require('./_utils');
const { VENDORS } = require('./_vendor');
const bs58 = require('bs58');

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return jsonErr(res, 405, 'GET only');

  const id = req.query?.id;
  const vendor = VENDORS[id];
  if (!vendor) return jsonErr(res, 400, `unknown vendor. valid: ${Object.keys(VENDORS).join(', ')}`);

  const VENDOR_WALLET = process.env[vendor.envKey];
  if (!VENDOR_WALLET) return jsonErr(res, 500, `${vendor.envKey} env var not set`);

  let vendorPubkey;
  try { vendorPubkey = new PublicKey(VENDOR_WALLET); } catch { return jsonErr(res, 500, 'invalid vendor wallet'); }

  try {
    const connection = getConnection();
    const mint       = getMintPublicKey();
    const vendorATA  = getAssociatedTokenAddressSync(mint, vendorPubkey, false, TOKEN_2022_PROGRAM_ID);
    const vendorATAStr = vendorATA.toBase58();

    const sigs = await connection.getSignaturesForAddress(vendorATA, { limit: 5 }, 'confirmed');
    if (!sigs.length) {
      return jsonOk(res, { walletAddress: VENDOR_WALLET, transactions: [] });
    }

    // Fetch one at a time — Helius free plan does not support batch requests
    const txs = [];
    for (const sig of sigs) {
      const tx = await connection.getParsedTransaction(
        sig.signature,
        { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      );
      txs.push(tx);
    }

    const results = [];
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx || tx.meta?.err) continue;

      // Locate vendor ATA index in this transaction's account list
      const accountKeys = tx.transaction.message.accountKeys.map(k =>
        typeof k === 'string' ? k : k.pubkey.toBase58(),
      );
      const ataIndex = accountKeys.indexOf(vendorATAStr);
      if (ataIndex === -1) continue;

      // Amount received = post balance − pre balance for vendor ATA
      const pre  = tx.meta.preTokenBalances?.find(b => b.accountIndex === ataIndex);
      const post = tx.meta.postTokenBalances?.find(b => b.accountIndex === ataIndex);
      const preAmt  = pre?.uiTokenAmount?.uiAmount  ?? 0;
      const postAmt = post?.uiTokenAmount?.uiAmount ?? 0;
      const amount  = postAmt - preAmt;
      if (amount <= 0) continue;

      // Memo: check top-level + inner instructions
      const allIx = [
        ...(tx.transaction.message.instructions ?? []),
        ...(tx.meta.innerInstructions ?? []).flatMap(ii => ii.instructions ?? []),
      ];
      let memo = '';
      for (const ix of allIx) {
        const pid = typeof ix.programId === 'string' ? ix.programId : ix.programId?.toBase58?.();
        if (pid !== MEMO_PROGRAM) continue;
        if (ix.parsed) { memo = ix.parsed; break; }
        if (ix.data) {
          try { memo = Buffer.from(bs58.decode(ix.data)).toString('utf8'); } catch {}
          break;
        }
      }

      results.push({
        signature: sigs[i].signature,
        amount,
        memo,
        blockTime: tx.blockTime,
      });
    }

    return jsonOk(res, { walletAddress: VENDOR_WALLET, transactions: results });
  } catch (err) {
    console.error('[vendor-history]', err);
    return jsonErr(res, 500, err.message);
  }
};
