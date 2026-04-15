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
 * Build the styled HTML email body for a verification code.
 */
function buildVerificationEmailHtml(code) {
  const digits = String(code).split('');
  const digitBoxes = digits.map(d =>
    `<td style="width:54px;height:64px;background:#3d3d35;border:2px solid #4a493e;border-radius:12px;text-align:center;vertical-align:middle;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:bold;color:#e2d8a6;letter-spacing:0;">${d}</td>`
  ).join('\n              <td style="width:8px;"></td>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#2f3029;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2f3029;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background:#363630;border-radius:16px;overflow:hidden;border:1px solid #4a493e;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4a493e,#3d3d35);padding:32px 40px;text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#e2d8a6;letter-spacing:2px;">PLUMMET</div>
          <div style="font-size:13px;color:#b8b098;margin-top:4px;letter-spacing:1px;">WORD GAME</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px 20px;">
          <p style="color:#b8b098;font-size:16px;line-height:1.6;margin:0 0 8px;">Hey there!</p>
          <p style="color:#b8b098;font-size:16px;line-height:1.6;margin:0 0 28px;">Here's your verification code to finish setting up your account:</p>
        </td></tr>

        <!-- Code -->
        <tr><td align="center" style="padding:0 40px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              ${digitBoxes}
            </tr>
          </table>
        </td></tr>

        <!-- Subtext -->
        <tr><td style="padding:0 40px 36px;">
          <p style="color:#8a8570;font-size:13px;line-height:1.5;margin:0;text-align:center;">
            Enter this code in the app to continue.<br>It expires in <strong style="color:#e2d8a6;">30 minutes</strong>.
          </p>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 40px;"><div style="border-top:1px solid #4a493e;"></div></td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 40px 28px;text-align:center;">
          <p style="color:#8a8570;font-size:12px;line-height:1.5;margin:0;">
            If you didn't request this code, just ignore this email.<br>
            &copy; ${new Date().getFullYear()} Plummet
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send a 5-digit verification code to a user's email.
 */
export function sendVerificationCode(email, code) {
  return sendEmailNotification(
    email,
    '',
    `Plummet — Your code is ${code}`,
    buildVerificationEmailHtml(code)
  );
}
