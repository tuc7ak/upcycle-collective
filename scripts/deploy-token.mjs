import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  getMintLen,
  TYPE_SIZE,
  LENGTH_SIZE,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import bs58 from 'bs58';

// ── Config ────────────────────────────────────────────────────────────────────
const NETWORK = 'mainnet-beta';
const RPC_URL =
  NETWORK === 'mainnet-beta'
    ? 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27'
    : 'https://api.devnet.solana.com';

const TOKEN_NAME   = 'The Upcycle Collective';
const TOKEN_SYMBOL = 'TUC';
const TOKEN_URI    = ''; // leave empty for now; update after uploading logo to Arweave

// Load organiser keypair from env (never hardcode in source)
const PRIVATE_KEY = process.env.ORGANISER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌  Set ORGANISER_PRIVATE_KEY env var before running.');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const organiser  = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  const mint       = Keypair.generate(); // new random mint account

  console.log('Network:         ', NETWORK);
  console.log('Organiser wallet:', organiser.publicKey.toBase58());
  console.log('New mint address:', mint.publicKey.toBase58());

  // ── Check balance / airdrop on devnet ─────────────────────────────────────
  const balance = await connection.getBalance(organiser.publicKey);
  console.log(`Organiser balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (NETWORK === 'devnet' && balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('\nLow balance — requesting airdrop from devnet...');
    try {
      const sig = await connection.requestAirdrop(organiser.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('Airdrop done.');
    } catch {
      console.log('⚠️  Devnet airdrop rate-limited.');
      console.log('   → Go to https://faucet.solana.com and paste this address:');
      console.log('  ', organiser.publicKey.toBase58());
      console.log('   Then re-run this script.');
      process.exit(1);
    }
  }

  // ── Build Token-2022 mint with metadata extension ─────────────────────────
  const metadata = {
    mint:            mint.publicKey,
    name:            TOKEN_NAME,
    symbol:          TOKEN_SYMBOL,
    uri:             TOKEN_URI,
    additionalMetadata: [],
  };

  const mintLen   = getMintLen([ExtensionType.MetadataPointer]);
  const metaLen   = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports  = await connection.getMinimumBalanceForRentExemption(mintLen + metaLen);

  const tx = new Transaction().add(
    // 1. Create the mint account
    SystemProgram.createAccount({
      fromPubkey:    organiser.publicKey,
      newAccountPubkey: mint.publicKey,
      space:         mintLen,
      lamports,
      programId:     TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Point metadata to the mint itself
    createInitializeMetadataPointerInstruction(
      mint.publicKey,
      organiser.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
    // 3. Initialize the mint (0 decimals, organiser = mint authority & freeze authority)
    createInitializeMintInstruction(
      mint.publicKey,
      0,
      organiser.publicKey,
      organiser.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
    // 4. Write metadata
    createInitializeInstruction({
      programId:        TOKEN_2022_PROGRAM_ID,
      metadata:         mint.publicKey,
      updateAuthority:  organiser.publicKey,
      mint:             mint.publicKey,
      mintAuthority:    organiser.publicKey,
      name:             TOKEN_NAME,
      symbol:           TOKEN_SYMBOL,
      uri:              TOKEN_URI,
    }),
  );

  console.log('\nSending deploy transaction...');
  const signature = await sendAndConfirmTransaction(connection, tx, [organiser, mint]);
  console.log('✅  Token deployed!');
  console.log('Mint address:', mint.publicKey.toBase58());
  console.log('Explorer:    ', `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=${NETWORK}`);
  console.log('Signature:   ', signature);
  console.log('\n⬇️  Copy this mint address into your .env file as TOKEN_MINT=...');
}

main().catch(err => {
  console.error('❌ ', err.message);
  process.exit(1);
});
