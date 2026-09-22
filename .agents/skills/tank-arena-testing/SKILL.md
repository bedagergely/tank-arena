---
name: tank-arena-browser-testing
description: Run and verify real two-player Tank Arena browser matches with Colyseus state diagnostics.
---

# Local setup

- Activate Node using `source ~/.nvm/nvm.sh`, then run `pnpm dev` from the repository root.
- Read Vite's actual port; default client is http://localhost:3000 and Colyseus is ws://localhost:2567.
- When restarting, terminating a parent shell may leave pnpm/tsx/Vite descendants alive. Inspect `ps` and listening ports, then terminate only the identified project processes before relaunching. Do not mistake a second Vite instance on port 3001 and an EADDRINUSE server for a clean restart.
- No credentials are required locally. The development monitor is http://localhost:2567/monitor.

# Browser procedure

- Use two game tabs and a third Home tab to observe realtime room-list updates. Reuse the same room through multiple rounds.
- Plaza's open floor is useful for control and ricochet checks. Arena has a distinctly denser wall layout.
- Verify both list-based joining and joining by room ID; inspect host-only Start and both-Ready auto-start separately.
- Hold game keys using `hold_key`, not instantaneous key events. Click the canvas to clear chat focus first. Test chat-focus suppression separately.
- A close-wall shot approximately perpendicular to that wall can produce a fast owner hit after the bounce, exercising first-hit scoring and reset.
- Monitor → Inspect → State exposes player slots, readiness, tanks and bullets. Chat should not exist in synchronized state.
- For exact countdown/reset durations and projectile limits, attach read-only state/event observers to the existing browser room. Do not inject gameplay state or use replacement clients as evidence for browser controls.
- Inspect each tab's current DevTools console: aggregated console tooling may retain messages from previous reloads/runs. Separate software-WebGL environment warnings from application failures.

## Devin Secrets Needed

None for local development.
