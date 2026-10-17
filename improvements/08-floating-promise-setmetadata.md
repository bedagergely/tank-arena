# 08 — `void this.setMetadata(...)` can become an unhandled rejection

| | |
| --- | --- |
| Category | Robustness |
| Priority | Medium |
| Component | `apps/server/src/rooms/GameRoom.ts`, `eslint.config.mjs` |
| Verified | By code reading |

## Problem

`GameRoom` fires `setMetadata` without awaiting or catching it:

```ts
// onCreate
void this.setMetadata({ mapId, phase: "lobby" });

// setPhase
void this.setMetadata({ ...this.metadata, phase });
```

`setMetadata` returns a promise. If it rejects (transport hiccup, metadata driver
error), the rejection is unhandled — on Bun an unhandled rejection can terminate
the process, taking every room with it. Nothing surfaces the failure either.

## Proposed change

- Catch and log, e.g. `this.setMetadata({ ...this.metadata, phase }).catch((err) => console.error("[room] setMetadata failed", err));`,
  or make `setPhase` async and `await` it where it is called from async contexts.
- Turn the guard into a lint rule so it cannot regress: enable
  `@typescript-eslint/no-floating-promises` (the repo already uses
  `typescript-eslint`) with the typed-linting config, and fix any other findings it
  surfaces.

Note: `AGENTS.md` asks for no comments unless they carry real information — a short
reason on the `.catch` is fine, a narration is not.

## Acceptance test (write this first)

Two complementary checks:

1. **Lint regression:** add the rule to `eslint.config.mjs` and confirm
   `bun run lint` fails on the current `void this.setMetadata(...)` lines and passes
   once they are handled. The CI already runs `bun run lint`, so this is the durable
   guard.
2. **Runtime:** in a room test, install a `process.on("unhandledRejection", …)`
   listener, drive a room through `lobby → countdown → playing`, and assert no
   unhandled rejection is observed. (This only fails if `setMetadata` rejects; the
   lint rule is the reliable regression test.)

## Files likely touched

- `apps/server/src/rooms/GameRoom.ts`
- `eslint.config.mjs`
- possibly other files the new lint rule flags

## Definition of done

- No fire-and-forget promises remain (or each has a `.catch`).
- `bun run typecheck && bun run lint && bun run test` is green.
