const { PublicKey } = require('@solana/web3.js');
const { jsonOk, jsonErr } = require('./_utils');
const { blobUploadPhoto, sheetsGetValues, sheetsAppendRow } = require('./_google');

const TYPES = ['CLOTHES', 'ELECTRONICS', 'PLASTICS', 'PAPER'];
const CODE_RE = /^[A-Z2-9]{4,10}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { code: rawCode, wallet, type: rawType, photo } = req.body ?? {};
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return jsonErr(res, 400, 'invalid code');
  if (!wallet) return jsonErr(res, 400, 'wallet required');

  try {
    new PublicKey(wallet);
  } catch {
    return jsonErr(res, 400, 'invalid wallet address');
  }

  const type = String(rawType || '').toUpperCase();
  if (!TYPES.includes(type)) return jsonErr(res, 400, `type must be one of ${TYPES.join(', ')}`);
  if (!photo || !String(photo).startsWith('data:image/')) return jsonErr(res, 400, 'photo required');

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const photoLink = await blobUploadPhoto({ dataUrl: photo, filename: `donations/${code}-${Date.now()}.jpg` });

    // Batch number = a simple sequential counter, derived from how many
    // donation rows already exist. Good enough at event scale — staff work
    // through the Sheet roughly in order, no separate counter store needed.
    const existing = await sheetsGetValues({ spreadsheetId, range: 'A2:A' });
    const batch = existing.length + 1;

    await sheetsAppendRow({
      spreadsheetId,
      range: 'A:G',
      values: [code, wallet, type, batch, photoLink, 'pending', new Date().toISOString()],
    });

    return jsonOk(res, { success: true, batch, photoLink });
  } catch (err) {
    console.error('[donate-photo]', err);
    return jsonErr(res, 500, err.message);
  }
};
