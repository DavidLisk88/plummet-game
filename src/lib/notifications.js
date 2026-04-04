// ============================================================
// NOTIFICATIONS — Email notification system via EmailJS
// ============================================================
// Uses EmailJS for free client-side email sending (200/mo free).
// No backend required.
//
// Setup instructions:
//   1. Go to https://www.emailjs.com/ and create a free account
//   2. Add an email service (Gmail, Outlook, etc.)
//   3. Create an email template with variables:
//        {{to_email}}, {{to_name}}, {{subject}}, {{message}}
//   4. Copy your IDs into .env:
//        VITE_EMAILJS_PUBLIC_KEY=your_public_key
//        VITE_EMAILJS_SERVICE_ID=your_service_id
//        VITE_EMAILJS_TEMPLATE_ID=your_template_id
// ============================================================

const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || '';
const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || '';
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || '';

const isConfigured = EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID;

if (!isConfigured) {
  console.info(
    '%c📧 PLUMMET — Email notifications not configured',
    'color: #9b8ec4; font-weight: bold;',
    '\nTo enable, add to .env:\n  VITE_EMAILJS_PUBLIC_KEY=...\n  VITE_EMAILJS_SERVICE_ID=...\n  VITE_EMAILJS_TEMPLATE_ID=...'
  );
}

/**
 * Send an email notification via EmailJS REST API (no SDK needed).
 */
export async function sendEmailNotification(toEmail, toName, subject, message) {
  if (!isConfigured) {
    throw new Error('Email service not configured. Add VITE_EMAILJS_* variables to .env.');
  }

  const payload = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      to_email: toEmail,
      to_name: toName,
      subject,
      message,
    },
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Email send failed (${response.status}): ${errorText}`);
  }
  return true;
}

/**
 * Send a 5-digit verification code to a user's email.
 */
export function sendVerificationCode(email, code) {
  return sendEmailNotification(
    email,
    '',
    'PLUMMET — Verify Your Email',
    `Your verification code is: ${code}\n\nThis code expires in 30 minutes.\nIf you didn't request this, please ignore this email.`
  );
}
