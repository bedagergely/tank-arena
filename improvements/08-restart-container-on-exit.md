# 08 — Restart the container when the Bun process exits

| | |
| --- | --- |
| Category | Robustness (process supervision) |
| Priority | Medium |
| Component | `docker-compose.yml`, `docker-compose.tls.yml`, `.github/workflows/ci.yml`, `Dockerfile` |
| Verified | Partly — compose sets a restart policy; nothing verifies it |

## Context

The original finding here was that `GameRoom` fires `setMetadata` without awaiting
it (`void this.setMetadata({ ... })`), so a rejection becomes an unhandled promise
rejection — and on Bun an unhandled rejection can terminate the process, taking
every live room down.

**Decision: keep the fire-and-forget call as it is.** The fix is not to catch the
promise; it is to make sure the process is supervised so that if Bun does exit, the
game comes back on its own. This file is now about that supervision.

## Problem

`docker-compose.yml` already declares `restart: unless-stopped` on the `game`
service, so a clean process exit *should* be restarted by Docker. But:

- Nothing verifies that it actually happens, and a regression (a removed policy, a
  changed service name, an `exec`-form entrypoint that swallows the exit code) would
  go unnoticed.
- The CI `docker` job runs the image with a bare `docker run -d … tank-arena` with
  **no** restart policy, so it exercises a different setup from production.
- A restart policy only helps when the process *exits*. If Bun wedges (event loop
  blocked, deadlocked room) it stays up and the container is never restarted, so the
  `HEALTHCHECK` and any orchestration that acts on it matter too.

## Proposed change

1. Keep/confirm `restart: unless-stopped` (or `always`) on the `game` service.
   `docker-compose.yml` sets it; `docker-compose.tls.yml` does not redefine `game`,
   so the base policy still applies after the overlay merges — verify that with
   `docker compose config` for the TLS `COMPOSE_FILE` combination too.
2. Make the supervision observable and covered:
   - add a CI step that starts the container with a restart policy, kills the Bun
     process inside it (`docker exec game … kill 1` or `pkill bun`), and asserts the
     container comes back healthy;
   - keep the `HEALTHCHECK` in the `Dockerfile` meaningful (it already probes
     `/__healthcheck`) so a wedged process is eventually reported unhealthy.
3. If the deploy docs claim a restart guarantee, state the exact scope in
   `DEPLOY.md`: a restart policy covers an *exit*, not a hang.

Do **not** add a `.catch()` to `setMetadata` as part of this change — that was
explicitly decided against.

## Acceptance test (write this first)

Extend the `docker` job in `.github/workflows/ci.yml`:

> start the image with `--restart unless-stopped` (or via `docker compose up -d`),
> wait for the healthcheck to pass, then kill the Bun process inside the container
> and assert that within N seconds the container is running again and
> `/__healthcheck` responds.

This fails against the current CI setup because the container is started without a
restart policy.

## Files likely touched

- `docker-compose.yml`, `docker-compose.tls.yml`
- `.github/workflows/ci.yml`
- `Dockerfile` (only if the healthcheck needs adjusting)
- `DEPLOY.md` (scope of the guarantee)

## Definition of done

- The new CI assertion passes; the container recovers from a killed process.
- `docker compose config` is valid for both compose files.
- `bun run typecheck && bun run lint && bun run test` is unchanged (green).
