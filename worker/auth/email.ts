import type { Env } from '../types';

export interface ISendOtpResult {
  deliveredVia: 'email' | 'console';
}

export async function sendOtpEmail(
  env: Env,
  email: string,
  code: string
): Promise<ISendOtpResult> {
  const isDevMode = env.DEV_MODE === 'true';
  const apiKey = env.EMAIL_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim() || 'noreply@modulus.josefyang.com';

  if (isDevMode || !apiKey) {
    console.log(`[DEV OTP] Email: ${email} | Code: ${code}`);
    if (!apiKey) {
      return { deliveredVia: 'console' };
    }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Modulus Telemetry <${from}>`,
      to: [email],
      subject: `${code} is your Modulus sign-in code`,
      text: `Your Modulus 6-digit sign-in code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `
        <div style="background:#0A0C10;color:#F1F5F9;font-family:Inter,system-ui,sans-serif;padding:32px;border-radius:12px;max-width:480px;margin:0 auto;border:1px solid #1E2532;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#00F0FF;margin-bottom:8px;">MODULUS TELEMETRY AUTH</div>
          <h2 style="margin:0 0 16px;font-size:20px;color:#FFFFFF;">Your 6-Digit Sign-In Code</h2>
          <div style="background:#12161F;border:1px solid #1E2532;border-radius:8px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:0.28em;color:#00F0FF;font-family:monospace;">
            ${code}
          </div>
          <p style="margin:18px 0 0;font-size:13px;color:#94A3B8;line-height:1.5;">
            Enter this code to sync your garage, builds, and credits for 30 days. This code expires in 10 minutes.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[EMAIL OTP ERROR] status=${res.status} body=${errText}`);
    if (isDevMode) {
      return { deliveredVia: 'console' };
    }
    throw new Error(`Email delivery failed (${res.status})`);
  }

  return { deliveredVia: 'email' };
}
