import { defineServer, defineRoom, monitor, LobbyRoom } from "colyseus";
import { listMaps } from "@tank-arena/shared";
import { gameRoom, GameRoom } from "./rooms/GameRoom.ts";

export const GAME_ROOM = "game";

const server = defineServer({
  rooms: {
    [GAME_ROOM]: defineRoom(gameRoom({rules: {maxPlayers: 4, minPlayers: 2}})).enableRealtimeListing(),
    lobby: defineRoom(LobbyRoom),
  },

  express: (app) => {
    app.get("/api/maps", (_req, res) => {
      res.json(listMaps().map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height })));
    });

    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }
  },
});

const latency = Number(process.env.LATENCY) || 0;
if (process.env.NODE_ENV !== "production" && !!latency) {
  server.simulateLatency(latency); 
}

export default server;
