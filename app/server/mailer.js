// server/mailer.js — outbound email for the forgot-password flow. Real SMTP
// delivery is opt-in via env vars (WGC_SMTP_HOST/PORT/USER/PASS/FROM); with
// none configured, it logs the message instead of losing it silently, which
// keeps the whole flow testable without needing a real mail account.
import { log } from './db.js';
import { emailPseudonym } from './pii.js';

const { WGC_SMTP_HOST, WGC_SMTP_PORT, WGC_SMTP_USER, WGC_SMTP_PASS, WGC_SMTP_FROM } = process.env;
const smtpConfigured = !!(WGC_SMTP_HOST && WGC_SMTP_USER && WGC_SMTP_PASS);

let transporterPromise = null;
async function getTransporter() {
  if (!smtpConfigured) return null;
  if (!transporterPromise) {
    transporterPromise = import('nodemailer').then(({ default: nodemailer }) =>
      nodemailer.createTransport({
        host: WGC_SMTP_HOST,
        port: Number(WGC_SMTP_PORT) || 587,
        secure: Number(WGC_SMTP_PORT) === 465,
        auth: { user: WGC_SMTP_USER, pass: WGC_SMTP_PASS },
      })
    );
  }
  return transporterPromise;
}

export async function sendEmail(to, subject, text) {
  const transporter = await getTransporter();
  if (!transporter) {
    // Dev-safe fallback: no SMTP configured, so the "email" is printed to
    // stdout instead of vanishing — set WGC_SMTP_* to send for real.
    //
    // The body goes to the CONSOLE ONLY and deliberately never reaches log().
    // system_log is persisted in the database and rendered verbatim at
    // /owner/logs, and these bodies carry password-reset codes in plaintext —
    // writing them there turned every reset into a durable, owner-readable
    // account-takeover token sitting beside the account's own email address.
    // stdout is ephemeral and visible only to whoever runs the process, which
    // is the audience this fallback was always for.
    console.log(`[mailer] (no SMTP configured) would send to ${to}: ${subject}\n${text}`);
    log('info', 'mailer', 'email not sent (SMTP not configured) — logged instead', { to: emailPseudonym(to), subject });
    return { sent: false };
  }
  await transporter.sendMail({ from: WGC_SMTP_FROM || WGC_SMTP_USER, to, subject, text });
  log('info', 'mailer', 'email sent', { to: emailPseudonym(to), subject });
  return { sent: true };
}

export const emailDeliveryConfigured = smtpConfigured;
