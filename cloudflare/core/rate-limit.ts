import { HttpError } from "./http";

/**
 * Throttle an expensive operation across several dimensions at once (IP,
 * account, tenant, endpoint) by folding them into one composite key.
 */
export async function enforceRateLimit(limiter: RateLimit, dimensions: Array<string | null | undefined>): Promise<void> {
  const key = dimensions.map((value) => (value ?? "unknown").slice(0, 80)).join("|");
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "RATE_LIMITED", "Too many requests. Please slow down and try again shortly.");
}

export function clientIp(request: Request): string {
  return (request.headers.get("CF-Connecting-IP") ?? "unknown").slice(0, 64);
}
