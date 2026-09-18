import { useState, type FormEvent } from "react";
import { listMaps, DEFAULT_MAP_ID, MAX_NAME_LENGTH } from "@tank-arena/shared";
import { createRoom, joinRoom, type GameRoom } from "../net/client.ts";
import { useRoomListing } from "../net/hooks.ts";

interface Props {
  onJoined: (room: GameRoom) => void;
}

const NAME_KEY = "tank-arena.name";

export function Home({ onJoined }: Props) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [mapId, setMapId] = useState(DEFAULT_MAP_ID);
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rooms, error: listError } = useRoomListing(!busy);

  async function run(action: () => Promise<GameRoom>) {
    setBusy(true);
    setError(null);
    localStorage.setItem(NAME_KEY, name.trim());
    try {
      onJoined(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect to the server.");
      setBusy(false);
    }
  }

  const opts = () => ({ name: name.trim() || undefined });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    void run(() => createRoom({ ...opts(), mapId }));
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    const id = roomId.trim();
    if (!id) return;
    void run(() => joinRoom(id, opts()));
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

        <form className="card" onSubmit={onJoin}>
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
                <button type="button" disabled={busy} onClick={() => void run(() => joinRoom(r.roomId, opts()))}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        </form>
      </div>

      {error && <p className="error">{error}</p>}
      <p className="muted help">Move: W/S or ↑/↓ · Turn: A/D or ←/→ · Fire: Space</p>
    </main>
  );
}
