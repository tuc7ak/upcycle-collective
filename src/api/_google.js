const { GoogleAuth } = require('google-auth-library');
const { put } = require('@vercel/blob');

// Kept out of _utils.js on purpose: every other endpoint (checkin, reward,
// transfer, tokenomics, vendor pays…) shares that file, and esbuild bundles
// each entry point independently — pulling Google's auth library in there
// would balloon every function's bundle, not just the donate ones that use it.

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
let cachedGoogleClient = null;

async function googleAccessToken() {
  if (!cachedGoogleClient) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
    const credentials = JSON.parse(raw);
    const auth = new GoogleAuth({ credentials, scopes: GOOGLE_SCOPES });
    cachedGoogleClient = await auth.getClient();
  }
  const tok = await cachedGoogleClient.getAccessToken();
  return typeof tok === 'string' ? tok : tok.token;
}

// Service accounts have no Drive storage quota on a plain (non-Workspace)
// Google account, so photos go to Vercel Blob instead — Sheets (user-owned,
// shared with the bot) still works fine and holds the link to each photo.
async function blobUploadPhoto({ dataUrl, filename }) {
  const match = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('invalid photo data');
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const blob = await put(filename, buffer, { access: 'public', contentType: mimeType });
  return blob.url;
}

async function sheetsGetValues({ spreadsheetId, range }) {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Sheets read failed');
  return data.values || [];
}

async function sheetsAppendRow({ spreadsheetId, range, values }) {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Sheets append failed');
  return data;
}

async function sheetsUpdateRange({ spreadsheetId, range, values }) {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Sheets update failed');
  return data;
}

module.exports = { blobUploadPhoto, sheetsGetValues, sheetsAppendRow, sheetsUpdateRange };
