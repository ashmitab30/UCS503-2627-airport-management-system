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

/**
 * Sends the one-time temp password to a newly created staff member.
 * Best-effort: logs and returns false on any failure rather than
 * throwing, so account creation itself never fails because of email.
 */
export async function sendStaffCredentialsEmail({ to, name, email, tempPassword, role }) {
  if (!transporter) {
    console.warn('[mail] SMTP not configured — skipping email, temp password only shown in-app.');
    return false;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  try {
    await transporter.sendMail({
      from,
      to,
      subject: 'Your Airport Ops account has been created',
      text: `Hi ${name},

An account has been created for you on the Airport Ops platform (role: ${role}).

Login email: ${email}
Temporary password: ${tempPassword}

Sign in at ${appUrl}/login and change your password after your first login.

This is an automated message — please do not reply.`,
      html: `
        <p>Hi ${name},</p>
        <p>An account has been created for you on the Airport Ops platform (role: <b>${role}</b>).</p>
        <p>
          <b>Login email:</b> ${email}<br/>
          <b>Temporary password:</b> <code>${tempPassword}</code>
        </p>
        <p>Sign in at <a href="${appUrl}/login">${appUrl}/login</a> and change your password after your first login.</p>
        <p style="color:#888;font-size:12px;">This is an automated message — please do not reply.</p>
      `,
    });
    return true;
  } catch (err) {
    console.error('[mail] failed to send staff credentials email:', err.message);
    return false;
  }
}