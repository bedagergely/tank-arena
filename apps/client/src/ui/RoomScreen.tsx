import { useEffect, useState } from "react";
import { useRoomState } from "@colyseus/react";
import { BOT_DIFFICULTIES, DEFAULT_BOT_DIFFICULTY, DEFAULT_RULES, getMap, winsNeeded, type BotDifficulty } from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";
import { Arena } from "./Arena.tsx";
import { Chat } from "./Chat.tsx";
import { PlayerList } from "./PlayerList.tsx";

interface Props {
  room: GameRoom;
  onLeave: () => void;
}

const ROUND_OPTIONS = Array.from(
  { length: DEFAULT_RULES.match.maxRounds - DEFAULT_RULES.match.minRounds + 1 },
  (_, i) => DEFAULT_RULES.match.minRounds + i,
);

export function RoomScreen({ room, onLeave }: Props) {
  const state = useRoomState(room);
  const [dropped, setDropped] = useState<string | null>(null);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>(DEFAULT_BOT_DIFFICULTY);

  useEffect(() => {
    const handler = (code: number) => {
      if (code !== 1000 && code < 4000) setDropped(`Disconnected from the server (code ${code}).`);
      else onLeave();
    };
    room.onLeave(handler);
    return () => room.onLeave.remove(handler);
  }, [room, onLeave]);

  if (dropped) {
    return (
      <main className="room">
        <p className="error">{dropped}</p>
        <button onClick={onLeave}>Back to home</button>
      </main>
    );
  }

  if (!state?.players) {
    return (
      <main className="room">
        <p className="muted">Connecting…</p>
      </main>
    );
  }

  const map = getMap(state.mapId);
  const me = state.players[room.sessionId];
  const isHost = state.hostSessionId === room.sessionId;
  const seated = Object.values(state.players).filter((p) => p.slot >= 0);
  const canStart = isHost && state.phase === "lobby" && seated.length >= state.minPlayers;
  const canAddBot = isHost && state.phase === "lobby" && seated.length < state.maxPlayers;
  const roundOptions = ROUND_OPTIONS.includes(state.rounds)
    ? ROUND_OPTIONS
    : [...ROUND_OPTIONS, state.rounds].sort((a, b) => a - b);

  return (
    <main className="room">
      <header className="room-header">
        <h1>Tank Arena</h1>
        <span className="muted">
          Room <span className="mono">{room.roomId}</span> · {map?.name ?? state.mapId} · {state.phase}
          {state.phase !== "lobby" && ` · round ${state.round}/${state.rounds}`}
        </span>
        <button className="ghost" onClick={onLeave}>
          Leave
        </button>
      </header>

      <div className="room-body">
        {map ? <Arena room={room} state={state} map={map} /> : <p className="error">Unknown map “{state.mapId}”.</p>}

        <aside className="sidebar">
          <PlayerList room={room} state={state} />

          {state.phase === "lobby" && me && me.slot >= 0 && (
            <div className="lobby-actions">
              <label className="rounds">
                Best of
                {isHost ? (
                  <select
                    value={state.rounds}
                    onChange={(e) => room.send("setRounds", { rounds: Number(e.target.value) })}
                  >
                    {roundOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{state.rounds}</strong>
                )}
                <span className="muted">first to {winsNeeded(state.rounds)}</span>
              </label>
              {isHost && (
                <label className="rounds">
                  Bot
                  <select
                    value={botDifficulty}
                    onChange={(e) => setBotDifficulty(e.target.value as BotDifficulty)}
                    disabled={!canAddBot}
                  >
                    {BOT_DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <button disabled={!canAddBot} onClick={() => room.send("addBot", { difficulty: botDifficulty })}>
                    Add bot
                  </button>
                </label>
              )}
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
