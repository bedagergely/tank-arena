import { useEffect, useState } from "react";
import { getMap } from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";
import { useRoomState } from "../net/hooks.ts";
import { Arena } from "./Arena.tsx";
import { Chat } from "./Chat.tsx";
import { PlayerList } from "./PlayerList.tsx";

interface Props {
  room: GameRoom;
  onLeave: () => void;
}

export function RoomScreen({ room, onLeave }: Props) {
  useRoomState(room);
  const [dropped, setDropped] = useState<string | null>(null);

  useEffect(() => {
    const handler = (code: number) => {
      if (code !== 1000 && code < 4000) setDropped(`Disconnected from the server (code ${code}).`);
      else onLeave();
    };
    room.onLeave(handler);
    return () => room.onLeave.remove(handler);
  }, [room, onLeave]);

  const { state } = room;
  const map = getMap(state.mapId);
  const me = state.players.get(room.sessionId);
  const isHost = state.hostSessionId === room.sessionId;
  const seated = [...state.players.values()].filter((p) => p.slot >= 0);
  const canStart = isHost && state.phase === "lobby" && seated.length >= state.minPlayers;

  async function leave() {
    await room.leave(true);
    onLeave();
  }

  if (dropped) {
    return (
      <main className="room">
        <p className="error">{dropped}</p>
        <button onClick={onLeave}>Back to home</button>
      </main>
    );
  }

  return (
    <main className="room">
      <header className="room-header">
        <h1>Tank Arena</h1>
        <span className="muted">
          Room <span className="mono">{room.roomId}</span> · {map?.name ?? state.mapId} · {state.phase}
        </span>
        <button className="ghost" onClick={() => void leave()}>
          Leave
        </button>
      </header>

      <div className="room-body">
        {map ? <Arena room={room} map={map} /> : <p className="error">Unknown map “{state.mapId}”.</p>}

        <aside className="sidebar">
          <PlayerList room={room} />

          {state.phase === "lobby" && me && me.slot >= 0 && (
            <div className="lobby-actions">
              <button onClick={() => room.send("ready", { ready: !me.ready })}>
                {me.ready ? "Not ready" : "Ready"}
              </button>
              {isHost && (
                <button className="primary" disabled={!canStart} onClick={() => room.send("start", {})}>
                  Start game
                </button>
              )}
              {!isHost && <p className="muted">Waiting for the host to start…</p>}
            </div>
          )}

          <Chat room={room} />
        </aside>
      </div>
    </main>
  );
}
