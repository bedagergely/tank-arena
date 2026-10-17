# 11 — Nginx ships no security headers

| | |
| --- | --- |
| Category | Security (hardening) |
| Priority | Low |
| Component | `deploy/nginx/` |
| Verified | Yes — the templates set only gzip and the proxy body |

## Problem

`deploy/nginx/http/default.conf.template` sets `gzip` and proxies `location /`; the
TLS template and the shared `proxy.conf` snippet add nothing. There are no response
security headers: no `X-Content-Type-Options`, no frame/referrer policy, no CSP, and
no HSTS on the TLS listener.

The app is same-origin with no third-party embeds, so a strict policy is cheap to
add.

## Proposed change

- In the shared server block (both `http/` and `tls/` templates):
  - `add_header X-Content-Type-Options nosniff always;`
  - `add_header X-Frame-Options DENY always;` (or a `frame-ancestors 'none'` CSP)
  - `add_header Referrer-Policy no-referrer always;`
  - a Content-Security-Policy suitable for the built client: `default-src 'self'`;
    allow `connect-src` for the WebSocket origin; PixiJS/React are bundled, so
    `script-src 'self'`; styles are in the built CSS (Tailwind) so `style-src 'self'`
    — verify against `apps/client/dist` before locking it down.
- In `deploy/nginx/tls/default.conf.template` only:
  - `add_header Strict-Transport-Security "max-age=31536000" always;`

Remember nginx `add_header` inheritance: a nested `location` with its own
`add_header` drops the parent's, so put the shared headers where they are inherited
by `location /`.

## Acceptance test (write this first)

Extend the `docker` job in `.github/workflows/ci.yml` (it already runs the image and
curls endpoints):

> `curl -sI http://localhost/ | grep -i 'x-content-type-options: nosniff'` (and the
> other headers), mirroring the existing `curl -fs … | grep -q` assertions.

The job already starts nginx via compose; add the header assertions next to the
existing healthcheck/`api/maps` checks so a regression fails CI.

## Files likely touched

- `deploy/nginx/http/default.conf.template`
- `deploy/nginx/tls/default.conf.template`
- `.github/workflows/ci.yml`

## Definition of done

- Headers present on `/` and on the WebSocket-upgrade path without breaking it.
- The client still loads (no CSP violations) in the docker smoke test.
- CI is green.
