import { defineServer, defineRoom, monitor, LobbyRoom } from "colyseus";
import { listMaps } from "@tank-arena/shared";
import { GameRoom } from "./rooms/GameRoom.ts";

export const GAME_ROOM = "game";

const server = defineServer({
  rooms: {
    // Default 2-player duel. Add variants with `gameRoom({ rules: {...} })`.
    [GAME_ROOM]: defineRoom(GameRoom).enableRealtimeListing(),
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

export default server;
