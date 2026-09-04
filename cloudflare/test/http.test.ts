import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalRoute, recordRequest } from "../core/http";

describe("canonicalRoute", () => {
  it("replaces a raw invitation token with a placeholder", () => {
    const token = "SECRET_TOKEN_123_abcdefghijklmnop";
    expect(canonicalRoute(`/api/v1/invitations/${token}`)).toBe("/api/v1/invitations/:token");
  });

  it("replaces a raw live-share token with a placeholder, on both public route shapes", () => {
    const token = "aB3dEf6hIjKlMnOpQrStUvWxYz0123456789";
    expect(canonicalRoute(`/api/v1/live/${token}`)).toBe("/api/v1/live/:token");
    expect(canonicalRoute(`/live/${token}`)).toBe("/live/:token");
  });

  it("replaces UUID-shaped resource IDs with a placeholder", () => {
    const clubId = "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa";
    const teamId = "bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb";
    const playerId = "cccccccc-5555-4555-8555-cccccccccccc";
    expect(canonicalRoute(`/api/v1/clubs/${clubId}/teams/${teamId}/players/${playerId}`))
      .toBe("/api/v1/clubs/:id/teams/:id/players/:id");
  });

  it("leaves short, non-secret-shaped segments alone", () => {
    expect(canonicalRoute("/api/v1/clubs")).toBe("/api/v1/clubs");
    expect(canonicalRoute("/auth/login")).toBe("/auth/login");
    expect(canonicalRoute("/api/v1/invitations/accept")).toBe("/api/v1/invitations/accept");
  });
});

describe("recordRequest", () => {
  let logs: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    spy = vi.spyOn(console, "log").mockImplementation((line: string) => { logs.push(line); });
  });
  afterEach(() => spy.mockRestore());

  it("never logs a raw invitation token, but keeps a useful route", () => {
    const token = "SECRET_TOKEN_123_abcdefghijklmnop";
    const request = new Request(`https://example.invalid/api/v1/invitations/${token}`);
    recordRequest(Date.now(), request, new Response(null, { status: 200 }), { requestId: "r1" });
    const line = logs.join("\n");
    expect(line).not.toContain(token);
    expect(line).toContain("/api/v1/invitations/:token");
  });

  it("never logs a raw live-share token, but keeps a useful route", () => {
    const token = "aB3dEf6hIjKlMnOpQrStUvWxYz0123456789";
    const request = new Request(`https://example.invalid/api/v1/live/${token}`);
    recordRequest(Date.now(), request, new Response(null, { status: 200 }), { requestId: "r2" });
    const line = logs.join("\n");
    expect(line).not.toContain(token);
    expect(line).toContain("/api/v1/live/:token");
  });

  it("never logs query strings, only the path", () => {
    const request = new Request("https://example.invalid/api/v1/clubs?secret=shhh");
    recordRequest(Date.now(), request, new Response(null, { status: 200 }), { requestId: "r3" });
    expect(logs.join("\n")).not.toContain("shhh");
  });
});
