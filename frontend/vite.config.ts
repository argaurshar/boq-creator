import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the FastAPI backend on :8000.
// host + allowedHosts let it run behind the GitHub Codespaces port-forward proxy
// (the forwarded *.app.github.dev origin would otherwise be blocked by Vite).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
