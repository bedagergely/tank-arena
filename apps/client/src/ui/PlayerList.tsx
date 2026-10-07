import { colorFor } from "../game/GameRenderer.ts";
import type { GameRoom, GameStateSnapshot } from "../net/client.ts";

interface Props {
  room: GameRoom;
  state: GameStateSnapshot;
}

export function PlayerList({ room, state }: Props) {
  const players = Object.values(state.players).sort((a, b) => a.slot - b.slot);
  const inLobby = state.phase === "lobby";
  const isHost = state.hostSessionId === room.sessionId;

  return (
    <section className="card border border-base-300 bg-base-200">
      <div className="card-body gap-2 p-4">
        <h3 className="text-xs font-semibold tracking-wide text-base-content/60 uppercase">
          Players ({players.length}/{state.maxPlayers})
        </h3>
        <ul className="flex flex-col gap-1">
          {players.map((p) => (
            <li
              key={p.sessionId}
              className={`flex items-center gap-2 rounded-box px-2 py-1 ${p.sessionId === room.sessionId ? "bg-base-300" : ""}`}
            >
              <span
                className="inline-block size-3 shrink-0 rounded-sm"
                style={{ background: p.slot >= 0 ? cssColor(colorFor(p.slot)) : "#555" }}
              />
              <span className="flex-1 truncate">
                {p.name}
                {p.sessionId === room.sessionId && " (you)"}
              </span>
              {p.sessionId === state.hostSessionId && <span className="badge badge-neutral badge-sm uppercase">host</span>}
              {p.isBot && <span className="badge badge-secondary badge-sm uppercase">{p.difficulty} bot</span>}
              {inLobby && p.slot >= 0 && p.ready && !p.isBot && (
                <span className="badge badge-success badge-sm uppercase">ready</span>
              )}
              {p.slot < 0 && <span className="badge badge-ghost badge-sm uppercase">spectating</span>}
              <span className="text-sm text-base-content/60">{p.wins} W</span>
              {inLobby && isHost && p.isBot && (
                <button
                  className="btn btn-ghost btn-xs"
                  title="Remove bot"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => room.send("removeBot", { sessionId: p.sessionId })}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
