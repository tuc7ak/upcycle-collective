import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Raydium, TxVersion, getCpmmPdaAmmConfigId,
  CREATE_CPMM_POOL_PROGRAM, CREATE_CPMM_POOL_FEE_ACC,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import bs58 from 'bs58';
import Decimal from 'decimal.js';

const RPC_URL    = 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27';
const TUC_MINT   = '2hgWyBDWgw4xesu8NpwTAhHgy2gnAo5iBhsBNSasngRj';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Pool: 1 USDC = 100,000 TUC  →  price = 0.00001 USDC per TUC
const USDC_AMOUNT = 0.8;       // use 0.8 of the 0.82 available
const TUC_AMOUNT  = 80_000;    // keeps the same 0.00001 ratio

const organiser  = Keypair.fromSecretKey(bs58.decode(process.env.ORGANISER_PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');

console.log('Initialising Raydium SDK...');
const raydium = await Raydium.load({
  owner:      organiser,
  connection,
  cluster:    'mainnet',
  disableFeatureCheck: true,
  blockhashCommitment: 'confirmed',
});

// Fetch mint info for both tokens
const [tucInfo, usdcInfo] = await Promise.all([
  raydium.token.getTokenInfo(TUC_MINT),
  raydium.token.getTokenInfo(USDC_MINT),
]);

// Use default CPMM config (index 0)
const { publicKey: configId } = getCpmmPdaAmmConfigId(
  CREATE_CPMM_POOL_PROGRAM,
  0,
);

const tucAmountBN  = new BN(TUC_AMOUNT);
const usdcAmountBN = new BN(Math.floor(USDC_AMOUNT * 1e6));

console.log(`Creating CPMM pool: ${TUC_AMOUNT} TUC + ${USDC_AMOUNT} USDC`);
console.log(`Price: ${USDC_AMOUNT / TUC_AMOUNT} USDC per TUC ($${USDC_AMOUNT / TUC_AMOUNT})`);

const { execute, extInfo } = await raydium.cpmm.createPool({
  programId: CREATE_CPMM_POOL_PROGRAM,
  poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
  mintA: {
    address:     TUC_MINT,
    decimals:    tucInfo.decimals ?? 0,
    programId:   TOKEN_2022_PROGRAM_ID.toBase58(),
  },
  mintB: {
    address:     USDC_MINT,
    decimals:    usdcInfo.decimals ?? 6,
    programId:   TOKEN_PROGRAM_ID.toBase58(),
  },
  mintAAmount: tucAmountBN,
  mintBAmount: usdcAmountBN,
  startTime:   new BN(0),
  associatedOnly: false,
  ownerInfo: { useSOLBalance: true },
  txVersion: TxVersion.LEGACY,
  computeBudgetConfig: { units: 600000, microLamports: 10000 },
});

console.log('Sending pool creation transaction...');
const { txId } = await execute({ sendAndConfirm: true });
console.log('✅ Pool created!');
console.log('Transaction:', txId);
console.log('Pool ID:', extInfo.address.poolId?.toBase58?.() ?? 'check Solscan');
console.log('Solscan:', `https://solscan.io/tx/${txId}`);
