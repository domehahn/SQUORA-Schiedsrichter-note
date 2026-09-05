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
    /** Bound in production only (the one-time KV->D1 legacy migration path);
     * staging/development never had it, and no kv_namespaces are declared in
     * wrangler.jsonc any more — `wrangler types` regeneration doesn't know
     * about it, so it's hand-maintained here rather than there. Every use
     * already guards with `if (!env.LEGACY_DATA)`. */
    LEGACY_DATA?: KVNamespace;
  }
}
