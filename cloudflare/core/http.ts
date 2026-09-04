export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestLogContext {
  requestId: string;
  userId?: string;
  clubId?: string;
}

export const SECURITY_HEADERS: Record<string, string> = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function withHeaders(response: Response, requestId: string, noStore = false): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set("X-Request-Id", requestId);
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (noStore) headers.set("Cache-Control", "no-store");
  else if (headers.get("Content-Type")?.includes("text/html")) headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function json(body: unknown, requestId: string, status = 200): Response {
  return withHeaders(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }), requestId, true);
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message }, requestId }, requestId, error.status);
  }
  // Server-side only — the client response never carries internal detail.
  console.error(JSON.stringify({
    requestId, level: "error", code: "UNHANDLED_ERROR",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }));
  return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be processed." }, requestId }, requestId, 500);
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin && origin === new URL(request.url).origin) return;
  const site = request.headers.get("Sec-Fetch-Site");
  if (!origin && (site === "same-origin" || site === "none")) return;
  throw new HttpError(403, "CSRF_REJECTED", "The request was rejected.");
}

export async function readJson(request: Request, maxBytes = 1_048_576): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(length) || length > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request payload is too large.");
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new HttpError(415, "CONTENT_TYPE_REQUIRED", "JSON is required.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request payload is too large.");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The request contains invalid JSON.");
  }
}

export function recordRequest(startedAt: number, request: Request, response: Response, context: RequestLogContext): void {
  console.log(JSON.stringify({
    requestId: context.requestId,
    userId: context.userId,
    clubId: context.clubId,
    route: new URL(request.url).pathname,
    method: request.method,
    status: response.status,
    durationMs: Date.now() - startedAt,
  }));
}

