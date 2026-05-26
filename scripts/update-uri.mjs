import { Connection, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import { createUpdateFieldInstruction } from '@solana/spl-token-metadata';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL  = 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27';
const MINT     = '2hgWyBDWgw4xesu8NpwTAhHgy2gnAo5iBhsBNSasngRj';
const NEW_URI  = 'https://upcycle-collective.vercel.app/metadata.json';

const PRIVATE_KEY = process.env.ORGANISER_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('Set ORGANISER_PRIVATE_KEY'); process.exit(1); }

const connection = new Connection(RPC_URL, 'confirmed');
const organiser  = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const mint       = new PublicKey(MINT);

// Calculate extra rent needed for the new URI data
const mintAccountInfo  = await connection.getAccountInfo(mint);
const currentSize      = mintAccountInfo.data.length;
const additionalBytes  = NEW_URI.length + 4; // 4 bytes for length prefix
const newSize          = currentSize + additionalBytes;
const rentNeeded       = await connection.getMinimumBalanceForRentExemption(newSize);
const currentLamports  = mintAccountInfo.lamports;
const extraLamports    = Math.max(0, rentNeeded - currentLamports + 10000); // small buffer

console.log('Updating token URI to:', NEW_URI);
console.log(`Topping up mint account by ${extraLamports} lamports for extra storage...`);

const tx = new Transaction();

// Transfer extra SOL to mint account to cover rent for larger metadata
if (extraLamports > 0) {
  tx.add(SystemProgram.transfer({
    fromPubkey: organiser.publicKey,
    toPubkey:   mint,
    lamports:   extraLamports,
  }));
}

tx.add(
  createUpdateFieldInstruction({
    programId:       TOKEN_2022_PROGRAM_ID,
    metadata:        mint,
    updateAuthority: organiser.publicKey,
    field:           'uri',
    value:           NEW_URI,
  })
);

const sig = await sendAndConfirmTransaction(connection, tx, [organiser]);
console.log('✅ URI updated!');
console.log('Signature:', sig);
