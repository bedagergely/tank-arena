# AGENTS.md

Guidance for AI agents working in this repository. Read this before making changes.

## What this is

Tank Arena: a multiplayer browser tank game in a pnpm monorepo.

```
packages/shared   Engine-agnostic game core: rules, maps, fixed-step simulation, wire contracts. No runtime deps.
apps/server       Colyseus 0.18 server (Node >= 22). Owns all game truth.
apps/client       Vite + React UI, PixiJS renderer. Sends intents only, never simulates.
```

The server is authoritative: clients send intents (`input`, `chat`, `ready`, `start`, ...), and the
server clamps/validates every payload, runs the 30 Hz simulation, and syncs state via Colyseus schema.
See `README.md` for the full architecture and message table.

## Setup

Requires Node 22+ and pnpm 10+ (the pinned pnpm comes via `corepack enable`).

```sh
pnpm install
pnpm dev          # server on :2567, client on :3000
```

Use **pnpm only** — never npm or yarn. `pnpm-workspace.yaml` pins `minimumReleaseAge: 10080`
(resolve only package versions published 7+ days ago) and an `allowBuilds` allowlist. Do not weaken
these supply-chain guards; if a dependency fails to install, escalate instead of loosening them.

## Commands

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `pnpm test`      | Vitest for `packages/shared` + `apps/server`                        |
| `pnpm typecheck` | `tsc --noEmit` across all workspaces                                |
| `pnpm lint`      | ESLint over the whole repo                                          |
| `pnpm build`     | `apps/server/build/index.js` and `apps/client/dist/`                |
| `pnpm --filter @tank-arena/server start` | Run the built server                       |

Run `pnpm typecheck && pnpm lint && pnpm test` before finishing a task; CI (`.github/workflows/ci.yml`)
runs exactly these plus `pnpm build`, so a change that fails them will not merge.

Server test files boot a Colyseus server on `@colyseus/testing`'s fixed port, so they run
sequentially (`fileParallelism: false` in `apps/server/vitest.config.ts`). Keep it that way.

## Conventions

- TypeScript strict mode, `noUncheckedIndexedAccess`, ESM (`"type": "module"`). Imports may use
  explicit `.ts` extensions (`allowImportingTsExtensions`). Use `import type` for type-only imports
  (enforced by ESLint `consistent-type-imports`).
- Match the surrounding code. Do not add comments unless they carry real information; never remove
  existing comments.
- Keep game rules, map data, and simulation in `packages/shared`; keep all authority and validation
  on the server. The client only renders and sends intents.
- New maps are `MapSource` modules in `packages/shared/src/maps/data/` with the generated
  `data/index.ts` registry. The dev map editor (`?editor`) writes them into source via the Vite dev
  server only — commit the generated files.
- Never commit secrets. `.env` is gitignored; `.env.example` documents the variables.
- Add or update tests for behavior changes, especially in the shared engine and server rooms.

## Git workflow

**Always work on a new feature branch — never commit directly to `main`.**

1. Start from an up-to-date `main`: `git checkout main && git pull`.
2. Create a feature branch: `git checkout -b devin/<short-slug>` (existing branches follow
   `devin/<slug>` and `devin/<timestamp>-<slug>`).
3. Make the change and verify it (`pnpm typecheck && pnpm lint && pnpm test`).
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
