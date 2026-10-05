import { Resend } from "resend";
import { RASQ_DEMO_MOVEMENT_DISCLAIMER } from "./demo-copy";
import { isRasqDemoInternalTestSessionId } from "./demo-analytics-types";
import type { RasqDemoLeadSubmitIntent } from "./demo-leads-validation";
import { isValidRasqDemoLeadEmail } from "./demo-leads-validation";

export const RASQ_DEMO_CONFIRMATION_EMAIL_SUBJECT = "We received your RASQ demo interest";

export const RASQ_DEMO_CONFIRMATION_FROM = "RASQ Team <aisha@rasqhealth.com>";
export const RASQ_DEMO_CONFIRMATION_REPLY_TO = "aisha@rasqhealth.com";

const BRAND_TEAL = "#1D9E75";
const BRAND_DARK = "#0F172A";
const BRAND_MUTED = "#64748B";

let resendClientOverride: Resend | null | undefined;

/** Test-only — pass null to simulate missing API key. */
export function __setRasqDemoResendClientForTests(client: Resend | null | undefined): void {
  resendClientOverride = client;
}

function getResendClient(): Resend | null {
  if (resendClientOverride !== undefined) {
    return resendClientOverride;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export function isRasqDemoConfirmationEmailServiceConfigured(): boolean {
  return getResendClient() !== null;
}

export function buildRasqDemoConfirmationEmailHtml(recipientName: string | null): string {
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hello,";
  const disclaimer = escapeHtml(RASQ_DEMO_MOVEMENT_DISCLAIMER);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(RASQ_DEMO_CONFIRMATION_EMAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F1F5F9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_TEAL} 0%,#5DCAA5 100%);padding:28px 32px;">
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.12em;color:#ffffff;text-transform:uppercase;">Creative Motion Lab</p>
              <p style="margin:8px 0 0;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">RASQ</p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.92);">Rehabilitation intelligence platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BRAND_DARK};">${greeting}</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">
                Thank you for trying the <strong>RASQ Interactive Movement Demo</strong>. We have received your interest and appreciate you taking the time to explore RASQ.
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">
                A member of the RASQ team may contact you about a relevant next step, such as a free plan overview, consultation, or a future pilot opportunity — based on the details you shared.
              </p>
              <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:${BRAND_MUTED};padding:12px 14px;background:#FFFBEB;border-radius:8px;border:1px solid #FDE68A;">
                ${disclaimer}
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
                <strong>Creative Motion Lab</strong><br />
                RASQ · <a href="mailto:aisha@rasqhealth.com" style="color:${BRAND_TEAL};">aisha@rasqhealth.com</a><br />
                <a href="https://rasqhealth.com" style="color:${BRAND_TEAL};">rasqhealth.com</a>
              </p>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">
                For any questions about RASQ or potential pilot opportunities, please contact us at
                <a href="mailto:aisha@rasqhealth.com" style="color:${BRAND_TEAL};">aisha@rasqhealth.com</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
                This message confirms receipt of your demo interest. It is not a marketing subscription unless you separately opted in to RASQ product updates.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SendRasqDemoConfirmationEmailResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string };

export async function sendRasqDemoConfirmationEmail(input: {
  to: string;
  recipientName: string | null;
}): Promise<SendRasqDemoConfirmationEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    return { ok: false, error: "Email service is not configured." };
  }

  const html = buildRasqDemoConfirmationEmailHtml(input.recipientName);

  try {
    const { data, error } = await resend.emails.send({
      from: RASQ_DEMO_CONFIRMATION_FROM,
      replyTo: RASQ_DEMO_CONFIRMATION_REPLY_TO,
      to: input.to,
      subject: RASQ_DEMO_CONFIRMATION_EMAIL_SUBJECT,
      html,
    });

    if (error) {
      return { ok: false, error: error.message ?? "Unable to send confirmation email." };
    }

    return { ok: true, providerId: data?.id ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to send confirmation email.";
    return { ok: false, error: message };
  }
}

export function shouldSendRasqDemoConfirmationEmail(input: {
  submitIntent: RasqDemoLeadSubmitIntent;
  email: string | null;
  demoSessionId?: string | null;
}): boolean {
  if (input.demoSessionId && isRasqDemoInternalTestSessionId(input.demoSessionId)) {
    return false;
  }
  return input.submitIntent === "share" && isValidRasqDemoLeadEmail(input.email);
}
