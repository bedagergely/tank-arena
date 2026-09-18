import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Bundle workspace packages (source-only) and keep third-party deps external.
const external = Object.keys(pkg.dependencies)
  .filter((name) => !name.startsWith("@tank-arena/"))
  .flatMap((name) => [name, `${name}/*`]);

rmSync("build", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "build/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
});
