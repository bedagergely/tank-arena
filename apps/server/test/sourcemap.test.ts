import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";

import { remapProfile, type CpuProfile } from "../src/sourcemap.ts";

const SOURCE = ["export function marker() {", "  return 42;", "}", ""].join("\n");

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Bundle a tiny TS entry with a source map, exactly like apps/server/build.mjs does. */
async function bundle(): Promise<{ dir: string; entry: string; js: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tank-sourcemap-"));
  dirs.push(dir);
  const entry = join(dir, "entry.ts");
  await writeFile(entry, SOURCE);
  const js = join(dir, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: js,
    bundle: true,
    format: "esm",
    platform: "node",
    sourcemap: true,
    logLevel: "silent",
  });
  return { dir, entry, js };
}

/** A one-node profile whose only frame sits on `marker` in the emitted bundle. */
async function profileAtMarker(js: string): Promise<CpuProfile> {
  const lines = (await readFile(js, "utf8")).split("\n");
  const lineNumber = lines.findIndex((line) => line.includes("function marker"));
  if (lineNumber < 0) throw new Error("marker not found in bundle");
  return {
    nodes: [
      {
        callFrame: {
          functionName: "marker",
          scriptId: "1",
          url: pathToFileURL(js).href,
          lineNumber,
          columnNumber: lines[lineNumber]!.indexOf("marker"),
        },
      },
    ],
    startTime: 0,
    endTime: 1,
    samples: [],
    timeDeltas: [],
  };
}

describe("remapProfile", () => {
  it("maps bundled frames back to the original TypeScript", async () => {
    const { entry, js } = await bundle();
    const profile = await profileAtMarker(js);

    const before = profile.nodes[0]!.callFrame;
    expect(before.url).toBe(pathToFileURL(js).href);

    const remapped = await remapProfile(profile);
    const frame = remapped.nodes[0]!.callFrame;

    expect(frame.url).toBe(pathToFileURL(entry).href);
    const sourceLine = SOURCE.split("\n")[frame.lineNumber];
    expect(sourceLine).toContain("marker");
  });

  it("leaves scripts without a sibling source map untouched", async () => {
    const frame = {
      functionName: "internal",
      scriptId: "2",
      url: pathToFileURL(join(tmpdir(), "no-such-bundle.js")).href,
      lineNumber: 12,
      columnNumber: 3,
    };
    const remapped = await remapProfile({ nodes: [{ callFrame: { ...frame } }] });

    expect(remapped.nodes[0]!.callFrame).toEqual(frame);
  });

  it("ignores node: and empty urls", async () => {
    const profile: CpuProfile = {
      nodes: [
        { callFrame: { functionName: "nextTick", scriptId: "3", url: "node:internal/process/task_queues", lineNumber: 110, columnNumber: 17 } },
        { callFrame: { functionName: "(root)", scriptId: "0", url: "", lineNumber: -1, columnNumber: -1 } },
      ],
    };

    const remapped = await remapProfile(profile);
    expect(remapped.nodes[0]!.callFrame.url).toBe("node:internal/process/task_queues");
    expect(remapped.nodes[0]!.callFrame.lineNumber).toBe(110);
    expect(remapped.nodes[1]!.callFrame.url).toBe("");
  });

  it("keeps the rest of the profile intact", async () => {
    const { js } = await bundle();
    const profile = await profileAtMarker(js);
    const remapped = await remapProfile(profile);

    expect(remapped.startTime).toBe(0);
    expect(remapped.endTime).toBe(1);
    expect(remapped.samples).toEqual([]);
  });
});
