import { ARENA, PLAZA } from "./arena.ts";
import { compileMap, type GameMap, type MapSource } from "./types.ts";

export * from "./types.ts";

const SOURCES: MapSource[] = [ARENA, PLAZA];

const REGISTRY: ReadonlyMap<string, GameMap> = new Map(SOURCES.map((s) => [s.id, compileMap(s)]));

export const DEFAULT_MAP_ID = ARENA.id;

export function getMap(id: string): GameMap | undefined {
  return REGISTRY.get(id);
}

export function listMaps(): GameMap[] {
  return [...REGISTRY.values()];
}
