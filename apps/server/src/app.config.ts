import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineServer, defineRoom, LobbyRoom } from "colyseus";
import express from "express";
import { listMaps } from "@tank-arena/shared";
import { gameRoom } from "./rooms/GameRoom.ts";
import { adminMiddleware } from "./admin.ts";
import { monitorMiddleware } from "./monitor.ts";

export const GAME_ROOM = "game";

/** Built client (`apps/client/dist`); served by this process when present so a single port hosts the game. */
const CLIENT_DIR = process.env.CLIENT_DIR ?? fileURLToPath(new URL("../../client/dist", import.meta.url));

const server = defineServer({
  rooms: {
    [GAME_ROOM]: defineRoom(gameRoom({ rules: { maxPlayers: 4, minPlayers: 1 } })).enableRealtimeListing(),
    lobby: defineRoom(LobbyRoom),
  },

  express: (app) => {
    app.get("/api/maps", (_req, res) => {
      res.json(listMaps().map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height })));
    });

    // Open in development; in production only when MONITOR_PASSWORD is set,
    // where it is then gated behind basic auth.
    const monitorPanel = monitorMiddleware();
    if (monitorPanel) {
      app.use("/monitor", monitorPanel);
    } else {
      console.warn("[monitor] disabled: set MONITOR_PASSWORD to expose the /monitor panel");
    }

    // Same gating as the monitor: open in development, password-protected in
    // production, and not mounted at all without ADMIN_PASSWORD there.
    const adminPanel = adminMiddleware({ clientDir: CLIENT_DIR });
    if (adminPanel) {
      app.use("/admin", adminPanel);
    } else {
      console.warn("[admin] disabled: set ADMIN_PASSWORD to expose the /admin profiling panel");
    }

    if (existsSync(CLIENT_DIR)) {
      // The panel is served, auth-gated, at /admin; don't also hand out the raw
      // build output from the public static tree.
      app.get("/admin.html", (_req, res) => res.redirect("/admin"));
      app.use(express.static(CLIENT_DIR));
    }
  },
});

const latency = Number(process.env.LATENCY) || 0;
if (process.env.NODE_ENV !== "production" && !!latency) {
  server.simulateLatency(latency); 
}

export default server;
