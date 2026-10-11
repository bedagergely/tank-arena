import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

export interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface CpuProfileNode {
  callFrame: CallFrame;
  [key: string]: unknown;
}

export interface CpuProfile {
  nodes: CpuProfileNode[];
  [key: string]: unknown;
}

interface SourceMap {
  tracer: TraceMap;
  dir: string;
}

/** The source map sitting next to a bundled script, or `null` when there is none. */
async function loadSourceMap(url: string): Promise<SourceMap | null> {
  try {
    const mapPath = `${fileURLToPath(url)}.map`;
    const map = JSON.parse(await readFile(mapPath, "utf8"));
    return { tracer: new TraceMap(map, pathToFileURL(mapPath).href), dir: dirname(mapPath) };
  } catch {
    return null;
  }
}

function toFileUrl(source: string, mapDir: string): string {
  return source.startsWith("file:") ? source : pathToFileURL(resolve(mapDir, source)).href;
}

/**
 * Rewrite a V8 CPU profile so its frames point at the original sources.
 *
 * Production runs the esbuild bundle, so every frame from our code reports
 * `build/index.js` and bundle line numbers, which DevTools cannot resolve back
 * (it only applies source maps to traces it recorded itself). The build ships a
 * `.map` beside the bundle, so frames whose script has one are mapped to the
 * TypeScript file, line, column and function name. Scripts without a sibling map
 * (node internals, third-party packages) are left untouched.
 */
export async function remapProfile(profile: CpuProfile): Promise<CpuProfile> {
  const maps = new Map<string, SourceMap | null>();

  for (const node of profile.nodes) {
    const frame = node.callFrame;
    if (!frame.url.startsWith("file:") || frame.lineNumber < 0) continue;

    let map = maps.get(frame.url);
    if (map === undefined) {
      map = await loadSourceMap(frame.url);
      maps.set(frame.url, map);
    }
    if (!map) continue;

    // V8 reports 0-based positions; source maps are looked up with a 1-based line.
    const position = originalPositionFor(map.tracer, { line: frame.lineNumber + 1, column: frame.columnNumber });
    if (!position.source || position.line == null) continue;

    frame.url = toFileUrl(position.source, map.dir);
    frame.lineNumber = position.line - 1;
    frame.columnNumber = position.column ?? 0;
    if (position.name) frame.functionName = position.name;
  }

  return profile;
}
