import { describe, expect, it } from "vitest";
import { isTenantMeta } from "./tenant";

describe("tenant metadata", () => {
  it("accepts only server-issued club membership metadata", () => {
    expect(isTenantMeta({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "FC Beispielstadt",
      slug: "fc-beispielstadt-a1b2c3d4",
      cacheSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
      role: "viewer",
      permissions: ["club.read"],
    })).toBe(true);
    expect(isTenantMeta({ id: "client-only", name: "Untrusted" })).toBe(false);
  });
});
