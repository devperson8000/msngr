import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = host ? `${proto}://${host}` : 'https://msngr.vercel.app';
    const confirmationUrl = `${origin}/?email-confirmation-test=${encodeURIComponent(token)}`;

    // Ethereal creates a temporary SMTP account programmatically.
    // It captures mail for preview and does NOT deliver to the real recipient inbox.
    const testAccount = await nodemailer.createTestAccount();

    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });

    const info = await transporter.sendMail({
      from: `"msngr" <${testAccount.user}>`,
      to: email,
      subject: 'Confirm your msngr email — SMTP test',
      text: [
        'This is an msngr SMTP test using Ethereal.',
        '',
        'Confirmation link:',
        confirmationUrl,
        '',
        'Ethereal captures this message for preview and does not deliver it to your real inbox.'
      ].join('\\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;padding:28px;border:1px solid #e2e7e9;border-radius:16px;color:#111b21">
          <h1 style="margin:0 0 12px;font-size:28px">msngr</h1>
          <p>This is an SMTP test using Ethereal.</p>
          <p style="margin:24px 0">
            <a href="${confirmationUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#00a884;color:#fff;text-decoration:none;font-weight:700">Confirm email</a>
          </p>
          <p style="font-size:13px;color:#667781">Ethereal captures this message for preview and does not deliver it to your real inbox.</p>
        </div>
      `
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    console.log('Ethereal verification email preview:');
    console.log(previewUrl);

    return res.status(200).json({
      success: true,
      accepted: info.accepted,
      messageId: info.messageId,
      previewUrl
    });
  } catch (error) {
    console.error('Ethereal SMTP test failed:', error);
    return res.status(500).json({
      error: 'Failed to send Ethereal test email.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
