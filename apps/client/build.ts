import { rmSync } from "node:fs";
import tailwind from "bun-plugin-tailwind";

/**
 * Production build for the two client pages: the game (`index.html`) and the
 * ops-only profiling panel (`admin.html`). `Bun.build` bundles the scripts and
 * stylesheets each page references and rewrites the HTML to point at the
 * content-hashed outputs; the game server serves the result from `dist`.
 */

// `define` forces production semantics regardless of the ambient NODE_ENV: it
// drops the dev-only map editor and resolves the cross-origin server URL.
const PUBLIC_SERVER_URL = process.env.PUBLIC_SERVER_URL ?? "";

rmSync("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./index.html", "./admin.html"],
  outdir: "dist",
  target: "browser",
  plugins: [tailwind],
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.PUBLIC_SERVER_URL": JSON.stringify(PUBLIC_SERVER_URL),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
