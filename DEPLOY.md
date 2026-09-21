# Deploying to a VPS

The production build is a single Node process: the Colyseus server also serves the
built client from `apps/client/dist`, so one port (2567) hosts everything and the
client connects to the same origin it was loaded from. `docker-compose.yml` runs
that process behind Nginx, which terminates TLS with a Let's Encrypt certificate
kept fresh by a certbot sidecar.

```
browser ──443──> nginx ──2567──> game (node)
                  │
                 certbot (renews every 12h; nginx reloads every 6h)
```

## Prerequisites

- A Linux VPS with [Docker Engine + Compose plugin](https://docs.docker.com/engine/install/)
- A DNS `A`/`AAAA` record for your domain pointing at the VPS
- Ports 80 and 443 open in the provider firewall / `ufw`

## First deploy

```sh
git clone https://github.com/bedagergely/tank-arena.git
cd tank-arena
cp .env.example .env            # set DOMAIN and EMAIL
./deploy/init-tls.sh            # first certificate (starts nginx for the ACME challenge)
docker compose up -d --build    # builds the image, starts game + nginx + certbot
```

Open `https://<DOMAIN>` in two tabs and play. Set `STAGING=1` in `.env` for a dry
run against Let's Encrypt's staging CA (untrusted cert, no rate limits); remove
`deploy/certbot/conf` and re-run `init-tls.sh` to switch to a real certificate.

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

## Without Nginx / TLS

The image alone is enough for a LAN or behind an existing reverse proxy:

```sh
docker build -t tank-arena .
docker run -d --restart unless-stopped -p 2567:2567 tank-arena
```

Then browse to `http://<host>:2567`. If you put a different proxy in front,
forward WebSocket upgrades (`Upgrade`/`Connection` headers), pass
`X-Forwarded-Proto`, and use a long read timeout — see
`deploy/nginx/templates/default.conf.template` for a reference.

## Configuration

| Variable          | Where                | Purpose                                                  |
| ----------------- | -------------------- | -------------------------------------------------------- |
| `DOMAIN`, `EMAIL` | `.env`               | Nginx `server_name` and Let's Encrypt account            |
| `STAGING`         | `.env`               | Use the Let's Encrypt staging CA in `init-tls.sh`        |
| `PORT`            | `game` environment   | Server port (default 2567; nginx proxies to it)          |
| `CLIENT_DIR`      | `game` environment   | Override the static client directory                     |
| `VITE_SERVER_URL` | client build time    | Only needed if the client is hosted on a different origin |

`/monitor` is disabled when `NODE_ENV=production` (the image sets it).

## Scaling notes

This setup is a single game process, which is plenty for many concurrent 2-player
rooms. Running more than one process needs a shared presence/driver
(`@colyseus/redis-presence`, `@colyseus/redis-driver`) and sticky routing —
see the [Colyseus scalability docs](https://docs.colyseus.io/scalability).
