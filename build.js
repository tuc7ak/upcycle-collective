const { build } = require('esbuild');
require('dotenv').config();

// API bundle (Node.js serverless functions)
build({
  entryPoints: [
    'src/api/checkin.js',
    'src/api/reward.js',
    'src/api/pay/beer-stall.js',
    'src/api/transfer.js',
  ],
  bundle:   true,
  platform: 'node',
  target:   'node22',
  format:   'cjs',
  outdir:   'api',
  outbase:  'src/api',
});

// Privy frontend bundle (browser)
build({
  entryPoints: ['src/privy-login.jsx'],
  bundle:   true,
  platform: 'browser',
  target:   'es2020',
  format:   'iife',
  outfile:  'public/privy-login.js',
  jsx:      'automatic',
  minify:   true,
  define:   {
    'process.env.NODE_ENV':    '"production"',
    'process.env.PRIVY_APP_ID': JSON.stringify(process.env.PRIVY_APP_ID),
    'process.env.HELIUS_RPC':   JSON.stringify(process.env.HELIUS_RPC),
  },
});

console.log('Build complete → api/ + public/privy-login.js');
