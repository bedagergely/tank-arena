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
      <main className="mx-auto w-full max-w-6xl px-6 py-4">
        <div role="alert" className="alert alert-error">
          <span>{dropped}</span>
        </div>
        <button className="btn mt-3" onClick={onLeave}>
          Back to home
        </button>
      </main>
    );
  }

  if (!state?.players) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-4">
        <p className="flex items-center gap-2 text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          Connecting…
        </p>
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
    <main className="mx-auto w-full max-w-6xl px-6 py-4">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold">Tank Arena</h1>
        <span className="flex-1 text-sm text-base-content/60">
          Room <span className="font-mono">{room.roomId}</span> · {map?.name ?? state.mapId} ·{" "}
          <span className="badge badge-outline badge-sm">{state.phase}</span>
          {state.phase !== "lobby" && ` · round ${state.round}/${state.rounds}`}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onLeave}>
          Leave
        </button>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        {map ? <Arena room={room} state={state} map={map} /> : <p className="text-error">Unknown map “{state.mapId}”.</p>}

        <aside className="flex min-w-[260px] flex-1 flex-col gap-4">
          <PlayerList room={room} state={state} />

          {state.phase === "lobby" && me && me.slot >= 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                Best of
                {isHost ? (
                  <select
                    className="select select-sm w-20"
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
                <span className="text-base-content/60">first to {winsNeeded(state.rounds)}</span>
              </label>
              {isHost && (
                <label className="flex items-center gap-2 text-sm">
                  Bot
                  <select
                    className="select select-sm"
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
                  <button className="btn btn-sm" disabled={!canAddBot} onClick={() => room.send("addBot", { difficulty: botDifficulty })}>
                    Add bot
                  </button>
                </label>
              )}
              <button className="btn btn-sm" onClick={() => room.send("ready", { ready: !me.ready })}>
                {me.ready ? "Not ready" : "Ready"}
              </button>
              {isHost && (
                <button className="btn btn-primary btn-sm" disabled={!canStart} onClick={() => room.send("start", {})}>
                  Start game
                </button>
              )}
              {!isHost && <p className="text-sm text-base-content/60">Waiting for the host to start…</p>}
            </div>
          )}

          <Chat room={room} />
        </aside>
      </div>
    </main>
  );
}
