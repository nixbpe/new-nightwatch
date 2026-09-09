import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolvePorts } from "../../scripts/ports.mjs";

// Per-worktree ports keep parallel checkouts from colliding (scripts/ports.mjs).
const { webPort, apiPort } = resolvePorts();

export default defineConfig({
  // React Compiler (babel-plugin-react-compiler via plugin-react's
  // reactCompilerPreset) owns render-performance memoization;
  // apps/web/src intentionally carries no manual useMemo/useCallback.
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  // Workspace contracts ship as TypeScript source; keep them out of
  // pre-bundling so Vite transforms them as regular source.
  optimizeDeps: { exclude: ["@nightwatch/api-contract"] },
  resolve: {
    // shadcn/ui alias (components.json); "@/*" -> src, mirroring tsconfig paths.
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
