# 16 — Missing polish: mute, reduced motion, colour-only scoreboard

| | |
| --- | --- |
| Category | UI / accessibility |
| Priority | Low |
| Component | `apps/client/src/game/Sound.ts`, `apps/client/src/ui/Arena.tsx`, `apps/client/src/ui/SpookyBackground.tsx` |
| Verified | By code reading |

## Problem

Three small gaps in the client UI:

1. **No mute / volume control.** `Sound.ts` starts a shared `AudioContext` on first
   use and every `playCannon()` / `EngineSound` plays immediately. There is no way
   to silence the game, and engine sounds are created per tank.
2. **No reduced-motion support.** `SpookyBackground.tsx` animates pumpkins, ghosts,
   bats, embers and fog with `animate-float`, `animate-drift`, `animate-rise` and
   `animate-flicker`, ignoring `prefers-reduced-motion`.
3. **Colour-only scoreboard.** `Scoreboard` in `Arena.tsx` distinguishes players by a
   colour swatch plus their win count, with no text/ARIA label; the `Latency` chip
   has a `title` but no accessible name beyond the visible text.

## Proposed change

1. Add a persisted mute toggle (localStorage key like `tank-arena.muted`) exposed in
   the room header; gate `context()`/`playCannon`/`EngineSound.setThrottle` on it,
   and make the shared context respect it. Prefer a pure preference module
   (`readMuted()` / `writeMuted()`) so it is testable.
2. Add Tailwind `motion-reduce:` variants (or `@media (prefers-reduced-motion: reduce)`
   in `styles.css`) that stop the background animations.
3. Give the scoreboard swatches `aria-label`s (player name + wins) and make the
   scoreboard a labelled list; ensure `Latency` exposes its state to assistive tech.

## Acceptance test (write this first)

The client has no component-test infrastructure, so:

1. Unit-test the pure preference helpers (`readMuted`/`writeMuted` round-trip,
   default when unset, and tolerance of a corrupt stored value) under
   `apps/client/test/` with `bun test`.
2. For the audio/motion/ARIA parts, either add a lightweight DOM test setup
   (happy-dom + `@testing-library/react`) as part of this task — which is itself a
   worthwhile test-infra improvement — or document the manual verification steps and
   cover the pure logic. Do not claim a test exists if it does not.

## Files likely touched

- `apps/client/src/game/Sound.ts`
- `apps/client/src/ui/Arena.tsx`, `Latency.tsx`
- `apps/client/src/ui/SpookyBackground.tsx`, `styles.css`
- `apps/client/test/` (new)
- possibly `apps/client/package.json` (test deps, if adding a DOM setup)

## Definition of done

- Mute preference persists across reloads and silences all game audio.
- Background animations stop under `prefers-reduced-motion: reduce`.
- Scoreboard/ping expose accessible names.
- `bun run typecheck && bun run lint && bun run test` is green.
