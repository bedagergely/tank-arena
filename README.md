# Tank Arena

Multiplayer browser tank game. Authoritative [Colyseus](https://colyseus.io) server,
[PixiJS](https://pixijs.com) + [React](https://react.dev) client, in one pnpm monorepo.

Two tanks drop into opposite corners of a walled arena. Each can have one bullet in
flight; bullets bounce off walls and vanish after 5 bounces. First tank hit ends the
round and everyone returns to the room lobby. Each room has an ephemeral chat.

## Layout

```
packages/shared   Engine-agnostic game core: rules, maps, fixed-step simulation, wire contracts
apps/server       Colyseus 0.18 server (Node >= 22). Owns all game truth.
apps/client       Vite + React UI, PixiJS renderer. Sends intents only, never simulates.
```

## Getting started

Requires Node 22+ and pnpm 10+ (`corepack enable` gives you the pinned pnpm).

```sh
pnpm install
pnpm dev            # server on :2567, client on :3000
```

Open http://localhost:3000 in two tabs, create a room in one and join it from the
other (by ID or from the open-rooms list). The host presses **Start**, or both
players toggle **Ready**.

| Action  | Keys                     |
| ------- | ------------------------ |
| Move    | `W`/`S` or `↑`/`↓`       |
| Turn    | `A`/`D` or `←`/`→`       |
| Fire    | `Space` or `Enter`       |

Other scripts:

```sh
pnpm test           # shared engine tests + server room tests (vitest)
pnpm typecheck
pnpm lint
pnpm build          # apps/server/build/index.js, apps/client/dist/
pnpm --filter @tank-arena/server start
```

In production the server serves `apps/client/dist` itself and the client connects
to the origin it was loaded from, so a single port hosts the game. Set
`VITE_SERVER_URL` (e.g. `wss://game.example.com`) at client build time only when
the client is hosted elsewhere. The Colyseus monitor is at
`http://localhost:2567/monitor` outside production.

## Deployment

`Dockerfile` builds a self-contained image; `docker-compose.yml` runs it behind
Nginx with Let's Encrypt TLS. See [DEPLOY.md](DEPLOY.md).

## Architecture

### Server authority

Clients send only intents, and every payload is treated as untrusted:

| Message   | Payload                                   | Server-side handling                            |
| --------- | ----------------------------------------- | ----------------------------------------------- |
| `input`   | `{ throttle, turn, fire }`                | Clamped to `[-1, 1]` / `boolean`; ignored unless `playing` |
| `chat`    | `{ text }`                                | Trimmed, length-capped, rate-limited, broadcast; never stored |
| `ready`   | `{ ready }`                               | Lobby only, seated players only                  |
| `start`   | `{}`                                      | Host only, lobby only, needs `minPlayers`        |
| `setName` | `{ name }`                                | Sanitised                                        |

The server runs the simulation at a fixed tick (30 Hz), decides collisions, cooldowns,
bullet counts, bounces, deaths and the win condition, and syncs the resulting world
through Colyseus schema state. Fire/bounce/hit are also broadcast as events so the
client can play effects. Clients exceeding 60 messages/s are dropped by Colyseus.

### Configurable rules, maps, player counts

`packages/shared/src/rules.ts` defines `GameRules` (player counts, tick rate, tank and
bullet parameters, bounce limit, win condition) with `DEFAULT_RULES` and
`resolveRules(overrides)`. Maps are ASCII in `packages/shared/src/maps/` (`#` wall,
`.` floor, `1`-`9` spawn slots) compiled by `compileMap`. Register a room variant with
different rules or engine without touching the room logic:

```ts
// apps/server/src/app.config.ts
rooms: {
  game: defineRoom(GameRoom),
  ffa4: defineRoom(gameRoom({ rules: { maxPlayers: 4, winCondition: "last-standing" } })),
}
```

### Rust / WebAssembly boundary

The hot path lives behind `GameEngine` (`packages/shared/src/engine/engine.ts`):

```ts
interface GameEngine {
  reset(slots: number[]): void;
  setInput(slot: number, input: PlayerInput): void;
  eliminate(slot: number): void;
  step(dt: number): TickEvent[];
  readonly world: Readonly<World>;
}
```

`World`, `PlayerInput`, `GameRules` and `GameMap` are plain data (numbers, strings,
flat arrays), so a WASM implementation can be dropped in via
`gameRoom({ engineFactory })` while the room, networking and UI stay unchanged.
The reference implementation (`createJsEngine`) is pure and deterministic and is
covered by `packages/shared/test`.

### Chat

`chat` messages are validated and immediately re-broadcast to the room. Nothing is
kept in room state or on disk; the client holds its own scrollback for the session.
