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
      },
    }),
  ],
  test: {
    include: ["cloudflare/test/**/*.test.ts"],
  },
});
