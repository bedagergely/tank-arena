import { ColyseusSDK, type Room, type RoomAvailable } from "@colyseus/sdk";
import type { JoinOptions } from "@tank-arena/shared";
// Type-only imports: nothing from the server ends up in the browser bundle.
import type { default as server } from "@tank-arena/server/app.config";
import type { GameRoom as ServerGameRoom } from "@tank-arena/server/rooms/GameRoom";
import type { GameState } from "@tank-arena/server/rooms/schema/GameState";

export type { GameState };
export type GameRoom = Room<ServerGameRoom, GameState>;
export type RoomListing = RoomAvailable<{ mapId?: string; phase?: string }>;

export const GAME_ROOM = "game";

function defaultEndpoint(): string {
  const { protocol, hostname } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${hostname}:2567`;
}

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? defaultEndpoint();

export const sdk = new ColyseusSDK<typeof server>(SERVER_URL);

export function createRoom(options: JoinOptions): Promise<GameRoom> {
  return sdk.create(GAME_ROOM, options).then(withInitialState);
}

export function joinRoom(roomId: string, options: JoinOptions): Promise<GameRoom> {
  return (sdk.joinById(roomId, options) as Promise<GameRoom>).then(withInitialState);
}

/**
 * Join resolves before the first full state arrives: the handshake only creates an empty
 * reflected state (no maps yet), so wait for the first `ROOM_STATE` before handing the room to the UI.
 */
function withInitialState(room: GameRoom): Promise<GameRoom> {
  if (room.state?.players !== undefined) return Promise.resolve(room);
  return new Promise((resolve, reject) => {
    room.onStateChange.once(() => resolve(room));
    room.onLeave.once((code) => reject(new Error(`Left room before receiving state (code ${code})`)));
    room.onError.once((code, message) => reject(new Error(message ?? `Room error ${code}`)));
  });
}
