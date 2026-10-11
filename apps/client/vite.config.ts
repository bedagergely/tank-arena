import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mapEditorPlugin } from "./dev/mapEditorPlugin.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), mapEditorPlugin()],
  server: {
    port: 3000,
    // The profiling panel is served by the game server under /admin; proxy its API
    // from the dev server so the page runs on one origin (basic auth included).
    // Anchored on the trailing slash so /admin.html itself stays with Vite.
    proxy: { "^/admin/": "http://localhost:2567" },
  },
  build: {
    rollupOptions: {
      // Two pages from one build: the game and the ops-only profiling panel.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin.html", import.meta.url)),
      },
    },
  },
});
