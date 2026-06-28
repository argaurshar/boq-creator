import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Recover from stale code chunks after a new deploy. The app lazy-loads some
// modules (e.g. the PDF reader, the report) with dynamic import(); after a new
// version ships, a previously cached page references hashed chunk filenames that
// no longer exist, so the import 404s and surfaces as "Failed to fetch". Vite
// dispatches `vite:preloadError` in that case — reload once (guarded against
// loops) to pull the fresh assets instead of showing an error.
window.addEventListener("vite:preloadError", () => {
  if (!sessionStorage.getItem("boq.reloadedForChunk")) {
    sessionStorage.setItem("boq.reloadedForChunk", "1");
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
