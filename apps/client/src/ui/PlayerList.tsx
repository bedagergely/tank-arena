import { colorFor } from "../game/GameRenderer.ts";
import type { GameRoom, GameStateSnapshot } from "../net/client.ts";
import { BTN, BTN_GHOST, BTN_XS } from "./controls.ts";

interface Props {
  room: GameRoom;
  state: GameStateSnapshot;
}

const TAG = "rounded bg-base-300 px-1.5 py-0.5 text-[0.7rem] uppercase tracking-wide text-base-content/60";

export function PlayerList({ room, state }: Props) {
  const players = Object.values(state.players).sort((a, b) => a.slot - b.slot);
  const inLobby = state.phase === "lobby";
  const isHost = state.hostSessionId === room.sessionId;

  return (
    <section>
      <h3 className="mb-2 font-display text-lg text-primary">
        Players ({players.length}/{state.maxPlayers})
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {players.map((p) => (
          <li
            key={p.sessionId}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.sessionId === room.sessionId ? "bg-base-300/60" : ""}`}
          >
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ background: p.slot >= 0 ? cssColor(colorFor(p.slot)) : "#555" }}
            />
            <span className="flex-1">
              {p.name}
              {p.sessionId === room.sessionId && " (you)"}
            </span>
            {p.sessionId === state.hostSessionId && <span className={TAG}>host</span>}
            {p.isBot && <span className={`${TAG} bg-secondary/25 text-secondary`}>{p.difficulty} bot</span>}
            {inLobby && p.slot >= 0 && p.ready && !p.isBot && <span className={`${TAG} bg-success/20 text-success`}>ready</span>}
            {p.slot < 0 && <span className={TAG}>spectating</span>}
            <span className="text-xs text-base-content/60">{p.wins} W</span>
            {inLobby && isHost && p.isBot && (
              <button
                className={`${BTN} ${BTN_GHOST} ${BTN_XS}`}
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
    </section>
  );
}

export function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
