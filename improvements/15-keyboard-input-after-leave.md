# 15 — `useKeyboardInput` sends an input after the room is gone

| | |
| --- | --- |
| Category | Bug (client lifecycle) |
| Priority | Low |
| Component | `apps/client/src/game/useKeyboardInput.ts` |
| Verified | By code reading |

## Problem

The effect's cleanup calls `release()`, which calls `push()`, which can
`room.send("input", …)`:

```ts
const release = () => {
  held.clear();
  push();
};

return () => {
  window.removeEventListener("keydown", onDown);
  window.removeEventListener("keyup", onUp);
  window.removeEventListener("blur", release);
  release();          // <-- may send on a room that is leaving/left
};
```

The effect re-runs when `active` flips (e.g. the round ends) and on unmount, so the
teardown can fire a message after the room has been left or is in the process of
leaving, producing a send on a closed connection. The file also has no tests at all.

## Proposed change

- Do not send on teardown; just reset local state. The server clears the input when
  the player leaves, and the next phase ignores inputs anyway (the `input` handler
  returns unless `phase === "playing"`).
- Guard sends on the connection being open if the SDK exposes it.
- Extract the held-keys → `PlayerInput` mapping into an exported pure function
  (`computeInput(held: ReadonlySet<string>): PlayerInput`) so it can be tested
  without a DOM.

## Acceptance test (write this first)

New `apps/client/test/keyboardInput.test.ts` (`bun test`) for the extracted
`computeInput`:

- `W` and `↑` both map to `throttle: 1`; `S`/`↓` to `-1`.
- `A`/`←` map to `turn: -1`; `D`/`→` to `1`.
- Holding both forward and back yields `0` (the `axis(neg, pos)` "both → 0" rule);
  same for left/right.
- `Space` and `Enter` set `fire: true`.
- An empty set yields `IDLE_INPUT` (and equals the frozen constant, not a copy).

Plus, if feasible, a test that the teardown path does not call `room.send` (pass a
stub room and assert no send on unmount).

## Files likely touched

- `apps/client/src/game/useKeyboardInput.ts`
- `apps/client/test/keyboardInput.test.ts` (new)

## Definition of done

- New tests pass; `bun run typecheck && bun run lint && bun run test` is green.
- No message is sent during effect teardown.
