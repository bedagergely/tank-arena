import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Synchronised room state. Everything here is derived from server-side truth
 * (the engine world + room bookkeeping); clients never write to it.
 */

export const PlayerState = schema(
  {
    sessionId: t.string(),
    name: t.string(),
    /** Tank slot for the current/next match; -1 while spectating. */
    slot: t.int8().default(-1),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    wins: t.uint16().default(0),
  },
  "Player",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const TankState = schema(
  {
    slot: t.int8(),
    x: t.float32(),
    y: t.float32(),
    angle: t.float32(),
    alive: t.boolean().default(true),
  },
  "Tank",
);
export type TankState = SchemaType<typeof TankState>;

export const BulletState = schema(
  {
    id: t.uint32(),
    ownerSlot: t.int8(),
    x: t.float32(),
    y: t.float32(),
    bounces: t.uint8().default(0),
  },
  "Bullet",
);
export type BulletState = SchemaType<typeof BulletState>;

export const GameState = schema(
  {
    phase: t.string().default("lobby"),
    mapId: t.string().default(""),
    hostSessionId: t.string().default(""),
    minPlayers: t.uint8().default(2),
    maxPlayers: t.uint8().default(2),
    /** Collision sizes, published so clients render exactly what the server simulates. */
    tankRadius: t.float32().default(14),
    bulletRadius: t.float32().default(4),
    /** Whole seconds left in a timed phase (countdown / finished); 0 otherwise. */
    countdown: t.uint8().default(0),
    round: t.uint16().default(0),
    /** Slot of the last match's winner, -1 for none/draw. */
    winnerSlot: t.int8().default(-1),
    players: t.map(PlayerState),
    /** Keyed by slot. */
    tanks: t.map(TankState),
    /** Keyed by bullet id. */
    bullets: t.map(BulletState),
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;
