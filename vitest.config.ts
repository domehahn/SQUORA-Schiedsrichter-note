import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TEST_PASSWORD_HASH = "pbkdf2-sha256$100000$01010101010101010101010101010101$0a5cea6a96077c89c2e719a6adaac8df9216e53b118ff99290c775c8c7346382";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          AUTH_PASSWORD_HASH: TEST_PASSWORD_HASH,
          SESSION_SECRET: "unit-test-session-secret-with-at-least-32-bytes",
        },
      },
    }),
  ],
  test: {
    include: ["cloudflare/test/**/*.test.ts"],
  },
});
