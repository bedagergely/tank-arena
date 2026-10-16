import { rmSync } from "node:fs";

const pkg = JSON.parse(await Bun.file(new URL("./package.json", import.meta.url)).text());

// Bundle workspace packages (source-only) and keep third-party deps external.
const external = Object.keys(pkg.dependencies)
  .filter((name) => !name.startsWith("@tank-arena/"))
  .flatMap((name) => [name, `${name}/*`]);

rmSync("build", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "build",
  target: "bun",
  sourcemap: "external",
  external,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
