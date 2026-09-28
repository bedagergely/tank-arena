import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mapEditorPlugin } from "./dev/mapEditorPlugin.ts";

export default defineConfig({
  plugins: [react(), mapEditorPlugin()],
  server: { port: 3000 },
});
