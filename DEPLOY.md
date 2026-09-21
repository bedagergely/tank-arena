# Deploying to a VPS

The production build is a single Node process: the Colyseus server also serves the
built client from `apps/client/dist`, so one port (2567) hosts everything and the
client connects to the same origin it was loaded from. `docker-compose.yml` runs
that process behind Nginx on plain HTTP; `docker-compose.tls.yml` optionally adds
HTTPS with a Let's Encrypt certificate kept fresh by a certbot sidecar.

```
browser ──80──> nginx ──2567──> game (node)

with docker-compose.tls.yml:
browser ──443──> nginx ──2567──> game (node)
                  │
                 certbot (renews every 12h; nginx reloads every 6h)
```

## Prerequisites

- A Linux VPS with [Docker Engine + Compose plugin](https://docs.docker.com/engine/install/)
- Port 80 open in the provider firewall / `ufw` (plus 443 for HTTPS)
- For HTTPS: a DNS `A`/`AAAA` record for your domain pointing at the VPS

## First deploy (HTTP)

```sh
git clone https://github.com/bedagergely/tank-arena.git
cd tank-arena
cp .env.example .env            # optional: set DOMAIN; everything else can stay commented
docker compose up -d --build    # builds the image, starts game + nginx on port 80
```

Open `http://<ip-or-domain>` in two tabs and play.

## Enabling HTTPS

Edit `.env`:

```dotenv
DOMAIN=game.example.com                                  # your real domain
COMPOSE_FILE=docker-compose.yml:docker-compose.tls.yml   # adds 443 + certbot
EMAIL=you@your-domain.tld                                # Let's Encrypt account (must be real)
# STAGING=1                                              # dry run against the staging CA
```

Then:

```sh
./deploy/init-tls.sh            # first certificate (starts nginx for the ACME challenge)
docker compose up -d --build    # starts game + nginx (80 → 443 redirect) + certbot
```

`COMPOSE_FILE` in `.env` is picked up by every `docker compose` command, so
updates and operations below are the same with or without TLS. To go back to
HTTP, comment out `COMPOSE_FILE` and run `docker compose up -d --remove-orphans`.

If you tried `STAGING=1` first, remove `deploy/certbot/conf`, unset `STAGING`,
and re-run `init-tls.sh` to get a trusted certificate.

## Updating

```sh
git pull
docker compose up -d --build    # rebuilds the image and restarts only what changed
```

Restarting `game` drops players out of their current rooms (state is in memory);
they land back on the home screen and can create a new room.

## Operating

```sh
docker compose ps
docker compose logs -f game
docker compose exec nginx nginx -t   # validate the rendered nginx config
```

Certificates live in `deploy/certbot/conf` (git-ignored); back that directory up
if you want to avoid re-issuing on a rebuild of the host.

## Without Nginx

The image alone is enough for a LAN or behind an existing reverse proxy:

```sh
docker build -t tank-arena .
docker run -d --restart unless-stopped -p 2567:2567 tank-arena
```

Then browse to `http://<host>:2567`. If you put a different proxy in front,
forward WebSocket upgrades (`Upgrade`/`Connection` headers), pass
`X-Forwarded-Proto`, and use a long read timeout — see `deploy/nginx/proxy.conf`
for a reference.

## Configuration

| Variable          | Where                | Purpose                                                       |
| ----------------- | -------------------- | ------------------------------------------------------------- |
| `DOMAIN`          | `.env`               | Nginx `server_name` (optional on HTTP, required for TLS)      |
| `COMPOSE_FILE`    | `.env`               | `docker-compose.yml:docker-compose.tls.yml` enables HTTPS     |
| `EMAIL`           | `.env`               | Let's Encrypt account address for `init-tls.sh`               |
| `STAGING`         | `.env`               | Use the Let's Encrypt staging CA in `init-tls.sh`             |
| `PORT`            | `game` environment   | Server port (default 2567; nginx proxies to it)               |
| `CLIENT_DIR`      | `game` environment   | Override the static client directory                          |
| `VITE_SERVER_URL` | client build time    | Only needed if the client is hosted on a different origin     |

`/monitor` is disabled when `NODE_ENV=production` (the image sets it).

## Scaling notes

This setup is a single game process, which is plenty for many concurrent 2-player
rooms. Running more than one process needs a shared presence/driver
(`@colyseus/redis-presence`, `@colyseus/redis-driver`) and sticky routing —
see the [Colyseus scalability docs](https://docs.colyseus.io/scalability).
