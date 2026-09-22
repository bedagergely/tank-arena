import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineServer, defineRoom, monitor, LobbyRoom } from "colyseus";
import express from "express";
import { listMaps } from "@tank-arena/shared";
import { gameRoom } from "./rooms/GameRoom.ts";

export const GAME_ROOM = "game";

/** Built client (`apps/client/dist`); served by this process when present so a single port hosts the game. */
const CLIENT_DIR = process.env.CLIENT_DIR ?? fileURLToPath(new URL("../../client/dist", import.meta.url));

const server = defineServer({
  rooms: {
    [GAME_ROOM]: defineRoom(gameRoom({rules: {maxPlayers: 4, minPlayers: 1, bullet: {maxPerTank: 5}}})).enableRealtimeListing(),
    lobby: defineRoom(LobbyRoom),
  },

  express: (app) => {
    app.get("/api/maps", (_req, res) => {
      res.json(listMaps().map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height })));
    });

    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }

    if (existsSync(CLIENT_DIR)) {
      app.use(express.static(CLIENT_DIR));
    }
  },
});

const latency = Number(process.env.LATENCY) || 0;
if (process.env.NODE_ENV !== "production" && !!latency) {
  server.simulateLatency(latency); 
}

export default server;
