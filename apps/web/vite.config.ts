import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace contracts ship as TypeScript source; keep them out of
  // pre-bundling so Vite transforms them as regular source.
  optimizeDeps: { exclude: ["@nightwatch/api-contract"] },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
