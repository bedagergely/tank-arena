import type { GameMap } from "../maps/types.ts";
import type { GameRules } from "../rules.ts";
import { createWorld, stepWorld } from "./simulation.ts";
import type { PlayerInput, TickEvent, World } from "./types.ts";

/**
 * Boundary between the game server and the simulation. The server only talks
 * to this interface; `JsGameEngine` is the reference implementation and a
 * Rust/WebAssembly module can implement the same contract (slots and plain
 * numbers in, a world snapshot and events out).
 */
export interface GameEngine {
  readonly map: GameMap;
  readonly rules: GameRules;
  /** Read-only view of the current world. Must not be mutated by callers. */
  readonly world: Readonly<World>;

  /** Replace the world with fresh tanks for the given slots. */
  reset(slots: readonly number[]): void;
  /** Store the latest intent for a slot; applied on the next `step`. */
  setInput(slot: number, input: PlayerInput): void;
  /** Take a tank out of the match (e.g. its player disconnected). */
  eliminate(slot: number): void;
  /** Advance by a fixed `dt` (seconds) and return what happened. */
  step(dt: number): TickEvent[];
}

export class JsGameEngine implements GameEngine {
  private _world: World;
  private readonly inputs: Array<PlayerInput | undefined> = [];

  constructor(
    public readonly map: GameMap,
    public readonly rules: GameRules,
  ) {
    this._world = createWorld(map, []);
  }

  get world(): Readonly<World> {
    return this._world;
  }

  reset(slots: readonly number[]): void {
    this._world = createWorld(this.map, slots);
    this.inputs.length = 0;
  }

  setInput(slot: number, input: PlayerInput): void {
    this.inputs[slot] = input;
  }

  eliminate(slot: number): void {
    const tank = this._world.tanks.find((t) => t.slot === slot);
    if (tank) tank.alive = false;
    this.inputs[slot] = undefined;
  }

  step(dt: number): TickEvent[] {
    return stepWorld(this._world, this.inputs, this.map, this.rules, dt);
  }
}

export type EngineFactory = (map: GameMap, rules: GameRules) => GameEngine;

export const createJsEngine: EngineFactory = (map, rules) => new JsGameEngine(map, rules);
