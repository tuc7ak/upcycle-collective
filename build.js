const { build } = require('esbuild');
require('dotenv').config();

build({
  entryPoints: [
    'src/api/checkin.js',
    'src/api/reward.js',
    'src/api/transfer.js',
    'src/api/vendor-history.js',
    'src/api/tokenomics.js',
    'src/api/pay/drinks.js',
    'src/api/pay/food-booth.js',
    'src/api/pay/merch.js',
    'src/api/pay/vip.js',
    'src/api/pay/game-zone.js',
    'src/api/pay/spice-market.js',
  ],
  bundle:   true,
  platform: 'node',
  target:   'node22',
  format:   'cjs',
  outdir:   'api',
  outbase:  'src/api',
});

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
