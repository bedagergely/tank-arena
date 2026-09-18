import type { PlayerInput } from "./engine/types.ts";

/** Wire payloads exchanged between client and server (msgpack-encoded by Colyseus). */

export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 16;

/** client -> server */
export interface ClientMessages {
  input: PlayerInput;
  chat: { text: string };
  ready: { ready: boolean };
  start: Record<string, never>;
  setName: { name: string };
}

export interface ChatMessage {
  from: string;
  name: string;
  text: string;
  /** Server wall-clock, ms since epoch. */
  at: number;
}

export interface SystemMessage {
  text: string;
  at: number;
}

export type GameEventMessage =
  | { type: "fire"; slot: number }
  | { type: "bounce"; x: number; y: number }
  | { type: "hit"; shooterSlot: number; targetSlot: number };

/** server -> client */
export interface ServerMessages {
  chat: ChatMessage;
  system: SystemMessage;
  event: GameEventMessage;
}

export interface JoinOptions {
  name?: string;
  /** Only honoured on room creation. */
  mapId?: string;
}

export type Phase = "lobby" | "countdown" | "playing" | "finished";
