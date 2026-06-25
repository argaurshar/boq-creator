import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The static build runs entirely in the browser (no backend), so it can be
// hosted on GitHub Pages. On a project Pages site assets live under
// /boq-creator/; in dev (Codespaces/local) they're served from root.
// host + allowedHosts let the dev server run behind the Codespaces port-forward.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/boq-creator/" : "/",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
}));
