import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readFileSync, readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    queries: readFileSync(`migrations/${name}`, "utf8").split(";").map((query) => query.trim()).filter(Boolean),
  }));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
        },
        // Production no longer binds LEGACY_DATA (KV → D1 migration complete,
        // blobs deleted). The migration code is still guarded and tested, so
        // give the test runtime a throwaway KV namespace to exercise it.
        kvNamespaces: ["LEGACY_DATA"],
      },
    }),
  ],
  test: {
    include: ["cloudflare/test/**/*.test.ts"],
  },
});
