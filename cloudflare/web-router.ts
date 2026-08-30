export interface Env {
  ASSETS: Fetcher;
}

const APP_PREFIX = "/schiedsrichter-note";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function rewriteRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function withResponseHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (headers.get("Content-Type")?.includes("text/html")) {
    headers.set("Cache-Control", "no-cache");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === APP_PREFIX) {
      url.pathname = `${APP_PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }

    const hasPrefix = url.pathname.startsWith(`${APP_PREFIX}/`);
    const relativePath = hasPrefix ? url.pathname.slice(APP_PREFIX.length) || "/" : url.pathname;
    let response = await env.ASSETS.fetch(rewriteRequest(request, relativePath));

    if (
      response.status === 404 &&
      request.method === "GET" &&
      (request.headers.get("Accept")?.includes("text/html") ?? false)
    ) {
      response = await env.ASSETS.fetch(rewriteRequest(request, "/"));
    }

    return withResponseHeaders(response);
  },
} satisfies ExportedHandler<Env>;
