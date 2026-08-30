import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_APP_BASE_PATH || "/";

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["squora-favicon.png", "squora-logo.png"],
        manifest: {
          name: "SQUORA Schiedsrichter Note",
          short_name: "Schiri Note",
          description: "Digitale Spieluhr, Spielnotiz und Turnierverwaltung für Fußball-Schiedsrichter.",
          lang: "de",
          dir: "ltr",
          theme_color: "#0b2559",
          background_color: "#0b2559",
          display: "standalone",
          orientation: "portrait",
          start_url: base,
          scope: base,
          icons: [
            { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // index.html is deliberately NOT precached: navigations must reach the
          // Worker so the login gate still applies. Offline falls back to the last
          // successful navigation response.
          globPatterns: ["**/*.{js,css,png,svg,woff2}"],
          globIgnores: ["**/index.html"],
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "html", networkTimeoutSeconds: 4, expiration: { maxEntries: 8 } },
            },
            {
              urlPattern: ({ url }) => url.pathname.endsWith("/api/archive"),
              handler: "NetworkOnly",
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
  };
});
