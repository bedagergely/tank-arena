import type { Snapshot } from "@colyseus/react";
import { ColyseusSDK, type Room, type RoomAvailable } from "@colyseus/sdk";
import type { JoinOptions } from "@tank-arena/shared";
// Type-only imports: nothing from the server ends up in the browser bundle.
import type { default as server } from "@tank-arena/server/app.config";
import type { GameRoom as ServerGameRoom } from "@tank-arena/server/rooms/GameRoom";
import type { GameState } from "@tank-arena/server/rooms/schema/GameState";

export type { GameState };
export type GameRoom = Room<ServerGameRoom, GameState>;
/** Immutable plain-object view of the room state as produced by `useRoomState`. */
export type GameStateSnapshot = Snapshot<GameState>;
export interface ListingMetadata {
  mapId?: string;
  phase?: string;
}
export type RoomListing = RoomAvailable<ListingMetadata>;

/** What the player asked for on the home screen; `useRoom` turns it into a connection. */
export type JoinRequest =
  | { kind: "create"; options: JoinOptions }
  | { kind: "join"; roomId: string; options: JoinOptions };

export const GAME_ROOM = "game";

function defaultEndpoint(): string {
  const { protocol, hostname } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${hostname}:2567`;
}

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? defaultEndpoint();

export const sdk = new ColyseusSDK<typeof server>(SERVER_URL);

export function connect(request: JoinRequest): Promise<GameRoom> {
  return request.kind === "create" ? createRoom(request.options) : joinRoom(request.roomId, request.options);
}

export function createRoom(options: JoinOptions): Promise<GameRoom> {
  return sdk.create(GAME_ROOM, options).then(withInitialState);
}

export function joinRoom(roomId: string, options: JoinOptions): Promise<GameRoom> {
  return (sdk.joinById(roomId, options) as Promise<GameRoom>).then(withInitialState);
}

/** Server-side LobbyRoom filter: only our room type, only rooms still in the lobby phase. */
export const LOBBY_FILTER = { name: GAME_ROOM, metadata: { phase: "lobby" } };

/**
 * The LobbyRoom pushes the initial "rooms" list right after join, before `useLobbyRoom`
 * has had a chance to register its handler (it does so in an effect). Absorb that push so
 * the SDK does not log an unhandled-message warning; `Home` asks for the list again once
 * subscribed by sending `LOBBY_FILTER`.
 */
export function joinLobby(): Promise<Room> {
  return sdk.joinOrCreate("lobby", { filter: LOBBY_FILTER }).then((room) => {
    room.onMessage("rooms", () => {});
    return room;
  });
}

/** Rooms a new player can actually join: our room type, still in the lobby, with a free seat. */
export function isJoinable(r: RoomListing): boolean {
  return r.name === GAME_ROOM && (r.metadata?.phase ?? "lobby") === "lobby" && r.clients < r.maxClients;
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
