import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import bs58 from 'bs58';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27';
const MINT    = '2hgWyBDWgw4xesu8NpwTAhHgy2gnAo5iBhsBNSasngRj';
const AMOUNT  = 100_000;

const organiser = Keypair.fromSecretKey(bs58.decode(process.env.ORGANISER_PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');
const mint = new PublicKey(MINT);

console.log('Minting', AMOUNT, 'TUC to organiser wallet...');
const ata = await getOrCreateAssociatedTokenAccount(
  connection, organiser, mint, organiser.publicKey, false, 'confirmed', {}, TOKEN_2022_PROGRAM_ID,
);
const sig = await mintTo(
  connection, organiser, mint, ata.address, organiser, AMOUNT, [], {}, TOKEN_2022_PROGRAM_ID,
);
console.log('✅ Minted! Signature:', sig);
