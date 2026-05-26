const { build } = require('esbuild');

const entryPoints = [
  'src/api/checkin.js',
  'src/api/reward.js',
  'src/api/pay/beer-stall.js',
  'src/api/transfer.js',
];

build({
  entryPoints,
  bundle:   true,
  platform: 'node',
  target:   'node22',
  format:   'cjs',
  outdir:   'api',
  outbase:  'src/api',
});

console.log('Build complete → api/');
