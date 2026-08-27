const { jsonOk, jsonErr } = require('./_utils');
const { sheetsGetValues } = require('./_google');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return jsonErr(res, 405, 'POST only');

  const { code: rawCode } = req.body ?? {};
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return jsonErr(res, 400, 'code required');

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return jsonErr(res, 500, 'Google Sheet not configured');

  try {
    const rows = await sheetsGetValues({ spreadsheetId, range: 'A2:G' });
    const row = rows.find(r => (r[0] || '').toUpperCase() === code);
    if (!row) return jsonErr(res, 404, 'Code not found. Check the label and try again.');

    const [, wallet, type, batch, photoLink, status, timestamp] = row;
    return jsonOk(res, {
      success: true, code, wallet, type,
      batch: batch || null, photoLink: photoLink || null,
      status: status || 'pending', timestamp: timestamp || null,
    });
  } catch (err) {
    console.error('[donate-lookup]', err);
    return jsonErr(res, 500, err.message);
  }
};
