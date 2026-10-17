import { serve } from "bun";
import index from "../index.html";
import admin from "../admin.html";
import { handleMapRequest } from "./mapStore.ts";

/**
 * Client dev server (replaces the Vite dev server). Bun bundles the two pages
 * on request, serves them with hot reloading, and routes the panel's API to the
 * game server. Open http://localhost:3000, or /admin.html for the profiling panel.
 */
const SERVER_ORIGIN = process.env.SERVER_ORIGIN ?? "http://localhost:2567";
const PORT = Number(process.env.PORT) || 3000;

serve({
  port: PORT,
  development: { hmr: true },
  routes: {
    "/": index,
    "/admin.html": admin,
    "/__editor/maps/:id": {
      PUT: (req) => editor("PUT", req),
      DELETE: (req) => editor("DELETE", req),
    },
  },
  // Anything else: proxy the panel API to the game server (as Vite's proxy did),
  // otherwise 404.
  fetch(req) {
    const { pathname, search } = new URL(req.url);
    if (pathname.startsWith("/admin/")) {
      return fetch(new URL(pathname + search, SERVER_ORIGIN), req);
    }
    return new Response("Not found", { status: 404 });
  },
});

async function editor(method: string, req: Bun.BunRequest<"/__editor/maps/:id">): Promise<Response> {
  try {
    return await handleMapRequest(method, req.params.id, req);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
