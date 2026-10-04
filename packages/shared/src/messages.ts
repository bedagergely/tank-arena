import type { BotDifficulty } from "./engine/bot.ts";
import type { PlayerInput } from "./engine/types.ts";
import type { PerkId } from "./rules.ts";

/** Wire payloads exchanged between client and server (msgpack-encoded by Colyseus). */

export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 16;

/** client -> server */
export interface ClientMessages {
  input: PlayerInput;
  chat: { text: string };
  ready: { ready: boolean };
  start: Record<string, never>;
  /** Host only, lobby only: number of rounds in the next match. */
  setRounds: { rounds: number };
  setName: { name: string };
  /** Host only, lobby only: seat a server-controlled AI opponent (default difficulty when omitted). */
  addBot: { difficulty?: BotDifficulty };
  /** Host only, lobby only: `sessionId` is the bot's key in `state.players`. */
  removeBot: { sessionId: string };
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
  | { type: "hit"; shooterSlot: number; targetSlot: number }
  | { type: "shield-block"; shooterSlot: number; targetSlot: number }
  | { type: "loot-spawn"; x: number; y: number }
  | { type: "loot-pickup"; slot: number; perk: PerkId };

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

/** `finished` shows a round result before the next round; `match-over` shows the final result before the lobby. */
export type Phase = "lobby" | "countdown" | "playing" | "finished" | "match-over";
