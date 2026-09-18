import { colorFor } from "../game/GameRenderer.ts";
import type { GameRoom } from "../net/client.ts";

interface Props {
  room: GameRoom;
}

export function PlayerList({ room }: Props) {
  const { state } = room;
  const players = [...state.players.values()].sort((a, b) => a.slot - b.slot);
  const inLobby = state.phase === "lobby";

  return (
    <section className="players">
      <h3>
        Players ({players.length}/{state.maxPlayers})
      </h3>
      <ul>
        {players.map((p) => (
          <li key={p.sessionId} className={p.sessionId === room.sessionId ? "me" : ""}>
            <span className="swatch" style={{ background: p.slot >= 0 ? cssColor(colorFor(p.slot)) : "#555" }} />
            <span className="name">
              {p.name}
              {p.sessionId === room.sessionId && " (you)"}
            </span>
            {p.sessionId === state.hostSessionId && <span className="tag">host</span>}
            {inLobby && p.slot >= 0 && p.ready && <span className="tag ready">ready</span>}
            {p.slot < 0 && <span className="tag">spectating</span>}
            <span className="wins">{p.wins} W</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
