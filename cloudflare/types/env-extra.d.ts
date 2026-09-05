// Extends the wrangler-generated Env (worker-configuration.d.ts) with secrets
// that aren't declared as plain vars in wrangler.jsonc. Set with:
//   wrangler secret put RESEND_API_KEY
//   wrangler secret put MAIL_FROM   (optional — defaults if unset, see email.ts)
export {};
declare global {
  interface Env {
    /** Resend (https://resend.com) API key. Password-reset email is a no-op
     * (logged, not fatal) until this is set. */
    RESEND_API_KEY?: string;
    /** Verified sender, e.g. "SQUORA Schiedsrichter Note <no-reply@squora.de>". */
    MAIL_FROM?: string;
  }
}
