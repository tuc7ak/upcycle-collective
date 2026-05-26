module.exports = async function handler(req, res) {
  const errors = [];
  const results = {};

  const pkgs = [
    '@solana/web3.js',
    '@solana/spl-token',
    '@solana/spl-memo',
    'bs58',
  ];

  for (const pkg of pkgs) {
    try {
      require(pkg);
      results[pkg] = 'ok';
    } catch (e) {
      results[pkg] = e.message.slice(0, 80);
      errors.push(pkg);
    }
  }

  res.status(200).json({ node: process.version, results, errors });
};
