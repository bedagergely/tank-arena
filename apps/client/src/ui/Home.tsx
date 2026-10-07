import { useEffect, useMemo, useState, type SubmitEvent } from "react";
import { useLobbyRoom } from "@colyseus/react";
import { listMaps, DEFAULT_MAP_ID, MAX_NAME_LENGTH } from "@tank-arena/shared";
import { isJoinable, joinLobby, LOBBY_FILTER, type JoinRequest, type ListingMetadata } from "../net/client.ts";

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
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">Tank Arena</h1>
      <p className="mt-1 text-base-content/60">Two tanks. One bullet each. Five bounces. Don&apos;t get hit.</p>

      <fieldset className="fieldset mt-6 max-w-xs">
        <legend className="fieldset-legend">Your name</legend>
        <input
          className="input w-full"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Anonymous"
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </fieldset>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <form className="card border border-base-300 bg-base-200" onSubmit={onCreate}>
          <div className="card-body gap-3">
            <h2 className="card-title text-lg">Create a room</h2>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Map</legend>
              <select className="select w-full" value={mapId} onChange={(e) => setMapId(e.target.value)} disabled={busy}>
                {listMaps().map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </fieldset>
            <div className="card-actions justify-end">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Create room
              </button>
            </div>
          </div>
        </form>

        <form className="card border border-base-300 bg-base-200" onSubmit={onJoinById}>
          <div className="card-body gap-3">
            <h2 className="card-title text-lg">Join a room</h2>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Room ID</legend>
              <input
                className="input w-full font-mono"
                value={roomId}
                placeholder="e.g. Ab3dEfGh1"
                onChange={(e) => setRoomId(e.target.value)}
                disabled={busy}
              />
            </fieldset>
            <div className="card-actions justify-end">
              <button type="submit" className="btn" disabled={busy || !roomId.trim()}>
                Join by ID
              </button>
            </div>

            <div className="divider my-0 text-xs tracking-wide text-base-content/60 uppercase">Open rooms</div>
            {listError && <p className="text-sm text-error">{listError}</p>}
            {rooms.length === 0 && !listError && (
              <p className="text-sm text-base-content/60">No open rooms yet — create one!</p>
            )}
            <ul className="list">
              {rooms.map((r) => (
                <li key={r.roomId} className="list-row items-center gap-3 p-2">
                  <span className="font-mono text-sm">{r.roomId}</span>
                  <span className="text-sm text-base-content/60">
                    {r.metadata?.mapId ?? "?"} · {r.clients}/{r.maxClients}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
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

      {error && (
        <div role="alert" className="alert alert-error mt-5">
          <span>{error.message || "Could not connect to the server."}</span>
        </div>
      )}
      <p className="mt-8 text-sm text-base-content/60">
        Move: <kbd className="kbd kbd-sm">W</kbd>/<kbd className="kbd kbd-sm">S</kbd> or <kbd className="kbd kbd-sm">↑</kbd>/
        <kbd className="kbd kbd-sm">↓</kbd> · Turn: <kbd className="kbd kbd-sm">A</kbd>/<kbd className="kbd kbd-sm">D</kbd> or{" "}
        <kbd className="kbd kbd-sm">←</kbd>/<kbd className="kbd kbd-sm">→</kbd> · Fire: <kbd className="kbd kbd-sm">Space</kbd>
      </p>
    </main>
  );
}
