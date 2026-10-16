# AGENTS.md

Guidance for AI agents working in this repository. Read this before making changes.

## What this is

Tank Arena: a multiplayer browser tank game in a Bun monorepo.

```
packages/shared   Engine-agnostic game core: rules, maps, fixed-step simulation, wire contracts. No runtime deps.
apps/server       Colyseus 0.18 server (Bun >= 1.4). Owns all game truth.
apps/client       Vite + React UI, PixiJS renderer. Sends intents only, never simulates.
```

The server is authoritative: clients send intents (`input`, `chat`, `ready`, `start`, ...), and the
server clamps/validates every payload, runs the 30 Hz simulation, and syncs state via Colyseus schema.
See `README.md` for the full architecture and message table.

## Setup

Requires [Bun](https://bun.sh) 1.4+ (the pinned version is in `packageManager`).

```sh
bun install
bun run dev      # server on :2567, client on :3000
```

Use **Bun only** — never npm, yarn or pnpm. `bunfig.toml` pins `minimumReleaseAge: 10080`
(resolve only package versions published 7+ days ago) and the root `package.json`
`trustedDependencies` list is the allowlist of packages that may run install scripts. Do not weaken
these supply-chain guards; if a dependency fails to install, escalate instead of loosening them.

## Commands

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `bun run test`   | Vitest for `packages/shared`, `apps/server` and `apps/client`        |
| `bun run typecheck` | `tsc --noEmit` across all workspaces                             |
| `bun run lint`   | ESLint over the whole repo                                          |
| `bun run build`  | `apps/server/build/index.js` and `apps/client/dist/`                |
| `bun run --filter @tank-arena/server start` | Run the built server                    |

`bun test` and `bun build` are Bun built-ins that shadow scripts of the same name, so
always invoke those two as `bun run test` / `bun run build`.

Run `bun run typecheck && bun run lint && bun run test` before finishing a task; CI
(`.github/workflows/ci.yml`) runs exactly these plus `bun run build`, so a change that fails
them will not merge.

Server test files boot a Colyseus server on `@colyseus/testing`'s fixed port, so they run
sequentially (`fileParallelism: false` in `apps/server/vitest.config.ts`). Keep it that way.
The client's `vitest.config.ts` deliberately skips the React/Tailwind plugins — it is for
pure logic (`src/admin/summarize.ts` and friends), not component tests.

## Conventions

- TypeScript strict mode, `noUncheckedIndexedAccess`, ESM (`"type": "module"`). Imports may use
  explicit `.ts` extensions (`allowImportingTsExtensions`). Use `import type` for type-only imports
  (enforced by ESLint `consistent-type-imports`).
- Match the surrounding code. Do not add comments unless they carry real information; never remove
  existing comments.
- Keep game rules, map data, and simulation in `packages/shared`; keep all authority and validation
  on the server. The client only renders and sends intents.
- The client builds two pages from one Vite config: the game (`index.html`) and the ops-only
  profiling panel (`admin.html`, `src/admin/`). All UI lives in `apps/client`; `apps/server/src/admin.ts`
  owns that panel's API and basic auth, and serves the built page. In dev the panel runs on the Vite
  server at `/admin.html` and proxies `/admin/` to the game server.
- The server runs on Bun (the image ships no Node), so run tooling through Bun and force the
  runtime with `bun --bun run <script>` when a package.json script shells out to a Node CLI.
  Bun's `node:inspector` implements the CPU `Profiler` domain but not `HeapProfiler`: CPU profiles
  go through the inspector and heap snapshots through `Bun.generateHeapSnapshot("v8")`
  (`apps/server/src/profiler.ts`). Sampling heap profiles have no Bun equivalent.
- New maps are `MapSource` modules in `packages/shared/src/maps/data/` with the generated
  `data/index.ts` registry. The dev map editor (`?editor`) writes them into source via the Vite dev
  server only — commit the generated files.
- Never commit secrets. `.env` is gitignored; `.env.example` documents the variables.
- `.env` is only read by the *server process* via `@colyseus/tools` (and by `docker compose` for
  `${VAR}` substitution) — Docker does not inject it into the container. Any env-gated server
  feature (`MONITOR_*`, `ADMIN_*`, ...) must also be forwarded in the `game` service
  `environment:` in `docker-compose.yml`, or it never reaches the container in production.
- Add or update tests for behavior changes, especially in the shared engine and server rooms.

## Git workflow

**Always work on a new feature branch — never commit directly to `main`.**

1. Start from an up-to-date `main`: `git checkout main && git pull`.
2. Create a feature branch: `git checkout -b devin/<short-slug>` (existing branches follow
   `devin/<slug>` and `devin/<timestamp>-<slug>`).
3. Make the change and verify it (`bun run typecheck && bun run lint && bun run test`).
4. **Commit when finished.** Focus the message on *why*, not *what*, matching the repo's existing
   style:

   ```sh
   git commit -m "$(cat <<'EOF'
   Short summary of the change

   A sentence or two on the reasoning and any trade-offs.

   Generated with [Devin](https://devin.ai)

   Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
   EOF
   )"
   ```

5. Do **not** push, force-push, or open a PR unless the user explicitly asks.
