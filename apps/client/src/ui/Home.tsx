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
    <main className="home">
      <h1>Tank Arena</h1>
      <p className="tagline">Two tanks. One bullet each. Five bounces. Don&apos;t get hit.</p>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Anonymous"
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </label>

      <div className="home-columns">
        <form className="card" onSubmit={onCreate}>
          <h2>Create a room</h2>
          <label className="field">
            <span>Map</span>
            <select value={mapId} onChange={(e) => setMapId(e.target.value)} disabled={busy}>
              {listMaps().map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            Create room
          </button>
        </form>

        <form className="card" onSubmit={onJoinById}>
          <h2>Join a room</h2>
          <label className="field">
            <span>Room ID</span>
            <input
              value={roomId}
              placeholder="e.g. Ab3dEfGh1"
              onChange={(e) => setRoomId(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !roomId.trim()}>
            Join by ID
          </button>

          <h3>Open rooms</h3>
          {listError && <p className="error">{listError}</p>}
          {rooms.length === 0 && !listError && <p className="muted">No open rooms yet — create one!</p>}
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.roomId}>
                <span className="mono">{r.roomId}</span>
                <span className="muted">
                  {r.metadata?.mapId ?? "?"} · {r.clients}/{r.maxClients}
                </span>
                <button type="button" disabled={busy} onClick={() => run({ kind: "join", roomId: r.roomId, options: opts() })}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        </form>
      </div>

      {error && <p className="error">{error.message || "Could not connect to the server."}</p>}
      <p className="muted help">Move: W/S or ↑/↓ · Turn: A/D or ←/→ · Fire: Space</p>
    </main>
  );
}
