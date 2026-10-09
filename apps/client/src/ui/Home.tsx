import { useEffect, useMemo, useState, type SubmitEvent } from "react";
import { useLobbyRoom } from "@colyseus/react";
import { listMaps, DEFAULT_MAP_ID, MAX_NAME_LENGTH } from "@tank-arena/shared";
import { isJoinable, joinLobby, LOBBY_FILTER, type JoinRequest, type ListingMetadata } from "../net/client.ts";
import { Pumpkin } from "./Pumpkin.tsx";
import { BTN, BTN_DEFAULT, BTN_PRIMARY, BTN_SM, CARD, CARD_BODY, INPUT, SELECT } from "./controls.ts";

interface Props {
  onJoin: (request: JoinRequest) => void;
  busy: boolean;
  error: Error | undefined;
}

const NAME_KEY = "tank-arena.name";

export function Home({ onJoin, busy, error }: Props) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [mapId, setMapId] = useState(DEFAULT_MAP_ID);
  const [roomId, setRoomId] = useState("");
  const lobby = useLobbyRoom<ListingMetadata>(joinLobby);
  // Runs after useLobbyRoom's own effect has subscribed, so this re-request is not lost.
  useEffect(() => {
    lobby.room?.send("filter", LOBBY_FILTER);
  }, [lobby.room]);
  const rooms = useMemo(() => lobby.rooms.filter(isJoinable), [lobby.rooms]);
  const listError = lobby.error?.message;

  function run(request: JoinRequest) {
    localStorage.setItem(NAME_KEY, name.trim());
    onJoin(request);
  }

  const opts = () => ({ name: name.trim() || undefined });

  function onCreate(e: SubmitEvent) {
    e.preventDefault();
    run({ kind: "create", options: { ...opts(), mapId } });
  }

  function onJoinById(e: SubmitEvent) {
    e.preventDefault();
    const id = roomId.trim();
    if (!id) return;
    run({ kind: "join", roomId: id, options: opts() });
  }

  return (
    <main className="relative z-10 mx-auto max-w-[860px] px-6 py-12">
      <header className="flex items-center gap-4">
        <Pumpkin className="h-16 w-16 shrink-0 animate-float drop-shadow-[0_0_18px_rgba(255,122,24,0.45)]" />
        <div>
          <h1 className="animate-flicker font-display text-[3rem] leading-none text-primary">Tank Arena</h1>
          <p className="mt-1 text-base-content/60">
            Two tanks. One bullet each. Five bounces. Don&apos;t get hit.
          </p>
        </div>
      </header>

      <label className="mt-8 mb-4 flex flex-col gap-1.5">
        <span className="text-xs tracking-widest text-base-content/60 uppercase">Your name</span>
        <input
          className={`${INPUT} w-full`}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Anonymous"
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </label>

      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
        <form className={CARD} onSubmit={onCreate}>
          <div className={`${CARD_BODY} gap-3 p-5`}>
            <h2 className="font-display text-2xl text-primary">Create a room</h2>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs tracking-widest text-base-content/60 uppercase">Map</span>
              <select className={`${SELECT} w-full`} value={mapId} onChange={(e) => setMapId(e.target.value)} disabled={busy}>
                {listMaps().map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={`${BTN} ${BTN_PRIMARY} mt-1`} type="submit" disabled={busy}>
              Create room
            </button>
          </div>
        </form>

        <form className={CARD} onSubmit={onJoinById}>
          <div className={`${CARD_BODY} gap-3 p-5`}>
            <h2 className="font-display text-2xl text-primary">Join a room</h2>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs tracking-widest text-base-content/60 uppercase">Room ID</span>
              <input
                className={`${INPUT} w-full`}
                value={roomId}
                placeholder="e.g. Ab3dEfGh1"
                onChange={(e) => setRoomId(e.target.value)}
                disabled={busy}
              />
            </label>
            <button className={`${BTN} ${BTN_DEFAULT}`} type="submit" disabled={busy || !roomId.trim()}>
              Join by ID
            </button>

            <h3 className="mt-3 text-sm tracking-widest text-base-content/50 uppercase">Open rooms</h3>
            {listError && <p className="text-error">{listError}</p>}
            {rooms.length === 0 && !listError && <p className="text-base-content/60">No open rooms yet — create one!</p>}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rooms.map((r) => (
                <li key={r.roomId} className="flex items-center gap-2.5 rounded-lg bg-base-300/60 px-3 py-2">
                  <span className="font-mono">{r.roomId}</span>
                  <span className="flex-1 text-xs text-base-content/60">
                    {r.metadata?.mapId ?? "?"} · {r.clients}/{r.maxClients}
                  </span>
                  <button
                    className={`${BTN} ${BTN_DEFAULT} ${BTN_SM}`}
                    type="button"
                    disabled={busy}
                    onClick={() => run({ kind: "join", roomId: r.roomId, options: opts() })}
                  >
                    Join
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </form>
      </div>

      {error && <p className="text-error">{error.message || "Could not connect to the server."}</p>}
      <p className="mt-8 text-xs text-base-content/50">
        Move: W/S or ↑/↓ · Turn: A/D or ←/→ · Fire: Space
      </p>
    </main>
  );
}
