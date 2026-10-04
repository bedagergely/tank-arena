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
    /** Round wins in the current (or last) match. */
    wins: t.uint16().default(0),
    /** Server-controlled AI opponent (no client behind this entry). */
    isBot: t.boolean().default(false),
    /** Bot difficulty id; empty for humans. */
    difficulty: t.string().default(""),
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
    /** Seconds left on each perk (0 = inactive); see PERK_* ids in shared. */
    perkBullets: t.float32().default(0),
    perkBulletSpeed: t.float32().default(0),
    perkTankSpeed: t.float32().default(0),
    perkShield: t.float32().default(0),
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

export const LootState = schema(
  {
    id: t.uint32(),
    x: t.float32(),
    y: t.float32(),
    perk: t.uint8(),
  },
  "Loot",
);
export type LootState = SchemaType<typeof LootState>;

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
    /** Rounds in the match (best-of); host-adjustable in the lobby. */
    rounds: t.uint8().default(5),
    /** Current round number within the match, 0 before the first round. */
    round: t.uint16().default(0),
    /** Slot of the last round's winner, -1 for none/draw. */
    winnerSlot: t.int8().default(-1),
    /** Slot of the match winner once the match is decided, -1 otherwise (or a drawn match). */
    matchWinnerSlot: t.int8().default(-1),
    players: t.map(PlayerState),
    /** Keyed by slot. */
    tanks: t.map(TankState),
    /** Keyed by bullet id. */
    bullets: t.map(BulletState),
    /** Keyed by loot id. */
    loot: t.map(LootState),
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;
