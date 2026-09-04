import { expect, test } from "@playwright/test";

/**
 * Remote smoke against deployed staging. Synthetic account only. These checks
 * verify the security-critical behaviour on the real runtime; they must not
 * create or mutate real club data.
 */
const EMAIL = process.env.STAGING_TEST_EMAIL ?? "";
const PASSWORD = process.env.STAGING_TEST_PASSWORD ?? "";
const ORIGIN = new URL(process.env.STAGING_URL ?? "https://schiri-staging.squora.de").origin;

test.beforeAll(() => {
  expect(EMAIL, "STAGING_TEST_EMAIL must be set").not.toBe("");
  expect(PASSWORD, "STAGING_TEST_PASSWORD must be set").not.toBe("");
});

test("unauthenticated API is rejected", async ({ request }) => {
  expect((await request.get("/api/v1/me")).status()).toBe(401);
  expect((await request.get("/api/v1/clubs")).status()).toBe(401);
});

test("cross-origin write is refused (CSRF)", async ({ request }) => {
  const res = await request.post("/api/v1/auth/login", {
    headers: { Origin: "https://evil.invalid", "Content-Type": "application/json" },
    data: {},
  });
  expect(res.status()).toBe(403);
});

test("login sets a hardened session cookie, then logout invalidates it", async ({ request }) => {
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(login.status(), await login.text()).toBe(200);
  const setCookie = login.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain("squora_session=");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).not.toContain("Domain="); // host-only

  const me = await request.get("/api/v1/me");
  expect(me.status()).toBe(200);

  const logout = await request.post("/api/v1/auth/logout", { headers: { Origin: ORIGIN } });
  expect(logout.status()).toBe(200);
  expect((await request.get("/api/v1/me")).status()).toBe(401);
});

test("a foreign club id is a 404, never a 403", async ({ request }) => {
  await request.post("/api/v1/auth/login", {
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    data: { email: EMAIL, password: PASSWORD },
  });
  const foreign = "00000000-0000-4000-8000-000000000000";
  expect((await request.get(`/api/v1/clubs/${foreign}`)).status()).toBe(404);
  expect((await request.get(`/api/v1/clubs/${foreign}/export`)).status()).toBe(404);
  expect((await request.get(`/api/v1/clubs/${foreign}/teams/${foreign}/state`)).status()).toBe(404);
});

test("security headers and no unsafe-inline in the CSP", async ({ request }) => {
  const res = await request.get("/login.css");
  const headers = res.headers();
  expect(headers["strict-transport-security"] ?? "").toContain("max-age=");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
});
