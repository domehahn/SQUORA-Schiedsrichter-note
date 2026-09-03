import { describe, expect, it } from "vitest";
import { createTenant, mergeTenantIndex, sanitizeTenantIndex, unlockTenant } from "./tenant";

describe("tenant", () => {
  it("creates metadata that only the right passphrase unlocks", async () => {
    const { meta } = await createTenant("SV Blau", "mein-geheimnis");
    expect(meta.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(meta.name).toBe("SV Blau");
    expect(await unlockTenant(meta, "mein-geheimnis")).not.toBeNull();
    expect(await unlockTenant(meta, "falsch")).toBeNull();
  });

  it("sanitizes a stored index and drops broken entries", () => {
    const index = sanitizeTenantIndex({
      tenants: [
        { id: "ok1", name: "A", salt: "s", verifierIv: "iv", verifier: "v", createdAt: "x" },
        { id: "bad id!", name: "B", salt: "s", verifierIv: "iv", verifier: "v" },
        { id: "ok2", name: "C" },
      ],
    });
    expect(index.tenants.map((tenant) => tenant.id)).toEqual(["ok1"]);
  });

  it("merges local + remote index by id, keeping locally created Vereine", () => {
    const meta = (id: string, name: string) => ({ id, name, salt: "s", verifierIv: "iv", verifier: "v", createdAt: "x" });
    const local = { updatedAt: null, tenants: [meta("a", "Alpha"), meta("local", "Nur lokal")] };
    const remote = { updatedAt: "2026-09-03T00:00:00.000Z", tenants: [meta("a", "Alpha (Server)"), meta("b", "Beta")] };
    const merged = mergeTenantIndex(local, remote);
    expect(merged.tenants.map((tenant) => tenant.id).sort()).toEqual(["a", "b", "local"]);
    expect(merged.tenants.find((tenant) => tenant.id === "a")!.name).toBe("Alpha (Server)");
  });
});
