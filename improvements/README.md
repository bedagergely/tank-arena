# Improvement handoffs

One file per proposed improvement, written to be handed to a coding agent on its
own — each contains the problem, the evidence, the proposed change, and an
acceptance test that should fail before the fix and pass after it.

Produced from a full read-through of the repo, then reviewed item by item. Baseline
at the time of writing was green: `bun run typecheck`, `bun run lint`, `bun run test`
(35 shared + 58 server + 12 client tests).

| # | Title | Category | Priority |
| --- | --- | --- | --- |
| [01](01-bot-shot-planner-desync.md) | Bot shot planner disagrees with the authoritative simulation | Bug | High |
| [02](02-solo-match-never-ends.md) | A lone player can start a match that never ends | Bug | High |
| [03](03-vacuous-minplayers-test.md) | `GameRoom.test.ts` has a test that asserts nothing | Tests | High |
| [04](04-no-reconnection-dead-connected-field.md) | Disconnects are permanent; `connected` is dead state | Bug | High |
| [05](05-inputs-never-expire.md) | A silent client keeps driving forever | Gameplay | Medium |
| [07](07-map-clearance-not-validated.md) | Map clearance is never checked on the real compile path | Bug | Medium |
| [08](08-restart-container-on-exit.md) | Restart the container when the Bun process exits | Robustness | Medium |
| [09](09-ratelimiter-untested.md) | `RateLimiter` has zero tests | Tests | Medium |
| [10](10-unbounded-room-creation.md) | Nothing caps room creation or joins | Security | Medium |
| [11](11-nginx-security-headers.md) | Nginx ships no security headers | Security | Low |
| [12](12-setname-mid-match-unrated.md) | `setName` works mid-match and is unrated | Robustness | Low |
| [13](13-no-game-metrics.md) | No game-level metrics or structured logs | Observability | Medium |
| [14](14-renderer-per-frame-allocations.md) | Per-frame allocations in the renderer | Performance | Low |
| [15](15-keyboard-input-after-leave.md) | `useKeyboardInput` sends an input after the room is gone | Bug | Low |
| [16](16-ui-polish-mute-reduced-motion-a11y.md) | Missing polish: mute, reduced motion, colour-only scoreboard | UI | Low |
| [17](17-editor-model-untested.md) | `editorModel.ts` is pure and untested | Tests | Medium |
| [18](18-physics-invariant-fuzz-test.md) | Physics invariant fuzz test | Tests | Low |

Numbers are stable handoff ids; gaps are intentional.

## Dropped

- **06 — A bullet cannot hit on the tick it reaches `maxBounces`.** The
  `stepBullets` ordering is deliberate: the simulation is authoritative and the bot
  must match it, not the other way round. The behavioural detail is now captured as
  a requirement inside [01](01-bot-shot-planner-desync.md).

## Reworked after review

- **01** — the fix must keep the planner **analytic and fast**, not fall back to a
  per-tick stepper replay. The file now spells out the exact `moveCircle` semantics
  the model has to reproduce and gates it on a differential equivalence test.
- **08** — the original finding (`void this.setMetadata(...)`) is explicitly kept
  as-is. The file is now about supervising the process so the container restarts if
  Bun exits.

## How to use these

1. Pick a file. It is self-contained; the agent needs no other context.
2. Work on its own branch (`devin/<slug>`) off an up-to-date `main`.
3. Write the acceptance test first and confirm it fails for the stated reason.
4. Implement the change, then run `bun run typecheck && bun run lint && bun run test`.

Repo conventions (Bun only, TypeScript strict, no comments unless they carry real
information, server stays authoritative) are documented in `AGENTS.md`.
