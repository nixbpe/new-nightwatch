import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolvePorts } from "../../scripts/ports.mjs";

// Per-worktree ports keep parallel checkouts from colliding (scripts/ports.mjs).
const { webPort, apiPort } = resolvePorts();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace contracts ship as TypeScript source; keep them out of
  // pre-bundling so Vite transforms them as regular source.
  optimizeDeps: { exclude: ["@nightwatch/api-contract"] },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${String(apiPort)}`,
        changeOrigin: true,
      },
    },
  },
});
