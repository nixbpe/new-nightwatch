import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolvePorts } from "../../scripts/ports.mjs";

// Per-worktree ports keep parallel checkouts from colliding.
const { webPort, apiPort } = resolvePorts();

export default defineConfig({
  // React Compiler owns memoization; src intentionally has no manual useMemo/useCallback.
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  // Workspace contracts ship as TypeScript source, so Vite must transform them rather than pre-bundle.
  optimizeDeps: { exclude: ["@nightwatch/api-contract"] },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
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
