import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL   = 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27';
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AMOUNT_SOL_LAMPORTS = 10_000_000; // 0.01 SOL ≈ $1.50

const organiser  = Keypair.fromSecretKey(bs58.decode(process.env.ORGANISER_PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');

console.log('Getting Jupiter quote for 0.01 SOL → USDC...');
const quoteRes = await fetch(
  `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${AMOUNT_SOL_LAMPORTS}&slippageBps=50`
);
const quote = await quoteRes.json();
console.log(`Quote: 0.01 SOL → ${(quote.outAmount / 1e6).toFixed(4)} USDC`);

console.log('Building swap transaction...');
const swapRes = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse:         quote,
    userPublicKey:         organiser.publicKey.toBase58(),
    wrapAndUnwrapSol:      true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 1000,
  }),
});
const { swapTransaction } = await swapRes.json();

const txBuf = Buffer.from(swapTransaction, 'base64');
const tx    = VersionedTransaction.deserialize(txBuf);
tx.sign([organiser]);

console.log('Sending swap...');
const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
await connection.confirmTransaction(sig, 'confirmed');
console.log('✅ Swap done! Signature:', sig);
console.log('USDC is now in your wallet.');
