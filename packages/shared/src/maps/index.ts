import { MAP_SOURCES } from "./data/index.ts";
import { compileMap, type GameMap, type MapSource } from "./types.ts";

export * from "./types.ts";
export * from "./ascii.ts";

const SOURCES: ReadonlyMap<string, MapSource> = new Map(MAP_SOURCES.map((s) => [s.id, s]));
const REGISTRY: ReadonlyMap<string, GameMap> = new Map(MAP_SOURCES.map((s) => [s.id, compileMap(s)]));

export const DEFAULT_MAP_ID = REGISTRY.has("arena") ? "arena" : (MAP_SOURCES[0]?.id ?? "");

export function getMap(id: string): GameMap | undefined {
  return REGISTRY.get(id);
}

export function listMaps(): GameMap[] {
  return [...REGISTRY.values()];
}

/** Author-facing source of a bundled map (what the map editor loads for editing). */
export function getMapSource(id: string): MapSource | undefined {
  return SOURCES.get(id);
}

export function listMapSources(): MapSource[] {
  return [...SOURCES.values()];
}
