/**
 * Minimal Resend (https://resend.com) client — a plain fetch call, no SDK
 * dependency. Requires the RESEND_API_KEY secret (wrangler secret put); if
 * unset, sendEmail logs and returns { sent: false } rather than throwing —
 * callers must never let email delivery change what they tell the caller
 * (e.g. password-reset stays a generic "check your inbox" response either
 * way, to avoid account enumeration and to not break the flow just because
 * mail isn't configured yet).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, message: EmailMessage): Promise<{ sent: boolean }> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({ level: "error", code: "EMAIL_NOT_CONFIGURED", message: "RESEND_API_KEY is not set; email was not sent." }));
    return { sent: false };
  }
  const from = env.MAIL_FROM || "SQUORA Schiedsrichter Note <no-reply@squora.de>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html, text: message.text }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ level: "error", code: "EMAIL_SEND_FAILED", status: response.status }));
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", code: "EMAIL_SEND_ERROR", message: error instanceof Error ? error.message : String(error) }));
    return { sent: false };
  }
}
