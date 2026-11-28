import nodemailer from 'nodemailer';

// Reads SMTP config from .env. If it's not filled in, we skip sending
// instead of crashing — account creation should never fail just because
// email isn't configured yet (e.g. in a fresh local dev setup).
function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // true for port 465, false for 587/others
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const transporter = buildTransport();

async function sendMailHelper({ to, subject, text, html }) {
  if (!transporter) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV ONLY - EMAIL NOT SENT]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n----------------------------------------`);
      return { sent: true, devFallback: true };
    }
    console.error('[mail] SMTP not configured in production environment');
    return { sent: false, error: 'SMTP_NOT_CONFIGURED' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[mail] failed to send email: code=${err.code || 'UNKNOWN'} message=${err.message}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV ONLY - EMAIL NOT SENT (SMTP FAILURE)]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n----------------------------------------`);
      return { sent: true, devFallback: true, error: err.code || err.message };
    }
    return { sent: false, error: err.code || err.message };
  }
}

/**
 * Sends the one-time temp password to a newly created staff member.
 */
export async function sendStaffCredentialsEmail({ to, name, email, tempPassword, role }) {
  const appUrl = process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:5173';
  const subject = 'Your Airport Ops account has been created';
  const text = `Hi ${name},

An account has been created for you on the Airport Ops platform (role: ${role}).

Login email: ${email}
Temporary password: ${tempPassword}

Sign in at ${appUrl}/login and change your password after your first login.

This is an automated message — please do not reply.`;

  const html = `
    <p>Hi ${name},</p>
    <p>An account has been created for you on the Airport Ops platform (role: <b>${role}</b>).</p>
    <p>
      <b>Login email:</b> ${email}<br/>
      <b>Temporary password:</b> <code>${tempPassword}</code>
    </p>
    <p>Sign in at <a href="${appUrl}/login">${appUrl}/login</a> and change your password after your first login.</p>
    <p style="color:#888;font-size:12px;">This is an automated message — please do not reply.</p>
  `;

  return sendMailHelper({ to, subject, text, html });
}

/**
 * Sends a 6-digit confirmation code for password change verification.
 */
export async function sendPasswordChangeCodeEmail({ to, name, code }) {
  const subject = 'Your Meridian Ops Password Change Verification Code';
  const text = `Hi ${name || 'Staff Member'},

Your 6-digit confirmation code to change your password is:

${code}

This code expires in 10 minutes. If you did not request a password change, please contact an administrator immediately.

This is an automated message — please do not reply.`;

  const html = `
    <p>Hi ${name || 'Staff Member'},</p>
    <p>Your 6-digit confirmation code to change your password is:</p>
    <h2 style="letter-spacing: 4px; font-family: monospace; background: #f1f5f9; padding: 10px 16px; display: inline-block; border-radius: 6px;">${code}</h2>
    <p>This code expires in 10 minutes. If you did not request a password change, please contact an administrator immediately.</p>
    <p style="color:#888;font-size:12px;">This is an automated message — please do not reply.</p>
  `;

  return sendMailHelper({ to, subject, text, html });
}
