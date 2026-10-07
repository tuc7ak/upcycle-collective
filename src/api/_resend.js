// Kept out of _utils.js on purpose, same reasoning as _google.js — esbuild
// bundles each entry point independently, and only tickets.js needs this.

async function sendEmail({ to, subject, html, from, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from || 'TUC <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Resend send failed');
  return data;
}

module.exports = { sendEmail };
