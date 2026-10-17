# 05 — A silent client keeps driving forever

| | |
| --- | --- |
| Category | Gameplay (robustness) |
| Priority | Medium |
| Component | `packages/shared` (`src/engine/engine.ts`, `src/rules.ts`) and/or `apps/server/src/rooms/GameRoom.ts` |
| Verified | By code reading |

## Problem

`GameEngine.setInput()` stores the last intent for a slot and it persists until it
is overwritten:

```ts
setInput(slot: number, input: PlayerInput): void {
  this.inputs[slot] = input;
}
```

`stepTanks()` then applies that input every tick. A client that stops sending —
tab backgrounded, phone slept, a lag spike, or a tampered client that just goes
quiet — leaves its tank pinned at the last throttle/turn forever, driving into a
wall. The only thing that clears an input is `eliminate()` on leave.

## Proposed change

Expire stale inputs. Preferred shape:

- Add `inputTimeoutSeconds` to `GameRules` (e.g. `0.75`), defaulted in `DEFAULT_RULES`.
- In `GameRoom`, timestamp the last message per slot and clear the engine input
  when it goes stale, **or** keep it in the engine: record a per-slot last-set time
  and have `stepTanks` substitute `IDLE_INPUT` when the input is older than the
  timeout.

Keep it simple and deterministic: the engine already receives `dt` per step, so
tracking "seconds since the last `setInput`" inside the engine keeps the
simulation self-contained and WASM-portable (no wall clock). A room-side wall-clock
check is acceptable too, but must not read `Date.now()` inside the pure `stepWorld`.

Make sure a legitimate held input (keys held down, so the client keeps re-sending
identical inputs) is **not** timed out — the client only sends on change, so the
timeout must be generous enough that a player holding a key is never cut off. If
that is a concern, have the client re-send its input on an interval (e.g. every
250 ms) and keep the server timeout at ~1 s.

## Acceptance test (write this first)

In `packages/shared/test/simulation.test.ts` (or a server test, depending on where
the timeout lives):

> set `throttle: 1` for slot 0, step for ~0.5 s (tank moves), then stop sending and
> step for `inputTimeoutSeconds + 0.5` s; assert the tank's position stops changing
> after the timeout.

Also add the inverse case: re-sending the same input each tick keeps the tank
moving indefinitely.

## Files likely touched

- `packages/shared/src/engine/engine.ts` (and/or `simulation.ts`)
- `packages/shared/src/rules.ts` (new field + default)
- `apps/server/src/rooms/GameRoom.ts` (if implemented room-side)
- `packages/shared/test/simulation.test.ts`

## Definition of done

- New tests pass; determinism test (`simulation.test.ts`) still passes.
- `bun run typecheck && bun run lint && bun run test` is green.
