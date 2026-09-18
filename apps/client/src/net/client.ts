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
  return sdk.create(GAME_ROOM, options);
}

export function joinRoom(roomId: string, options: JoinOptions): Promise<GameRoom> {
  return sdk.joinById(roomId, options) as Promise<GameRoom>;
}
