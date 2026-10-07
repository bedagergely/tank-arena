import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mapEditorPlugin } from "./dev/mapEditorPlugin.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), mapEditorPlugin()],
  server: { port: 3000 },
});
