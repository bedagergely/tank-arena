import { useEffect, useRef } from "react";
import type { GameMap } from "@tank-arena/shared";
import { GameRenderer } from "../game/GameRenderer.ts";
import { useKeyboardInput } from "../game/useKeyboardInput.ts";
import type { GameRoom } from "../net/client.ts";

interface Props {
  room: GameRoom;
  map: GameMap;
}

/** Hosts the PixiJS canvas and the overlay for non-playing phases. */
export function Arena({ room, map }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { state } = room;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: GameRenderer | undefined;
    let cancelled = false;
    void GameRenderer.mount(host, room, map).then((r) => {
      if (cancelled) {
        r.destroy();
        return;
      }
      renderer = r;
    });
    return () => {
      cancelled = true;
      renderer?.destroy();
    };
  }, [room, map]);

  useKeyboardInput(room, state.phase === "playing");

  const me = state.players.get(room.sessionId);
  const overlay = overlayFor(room, me?.slot ?? -1);

  return (
    <div className="arena" style={{ width: map.width, height: map.height }}>
      <div ref={hostRef} className="arena-canvas" />
      {overlay && <div className="arena-overlay">{overlay}</div>}
    </div>
  );
}

function overlayFor(room: GameRoom, mySlot: number) {
  const { state } = room;
  switch (state.phase) {
    case "lobby": {
      const seated = [...state.players.values()].filter((p) => p.slot >= 0).length;
      return (
        <>
          <h2>Waiting for players</h2>
          <p>
            {seated}/{state.minPlayers} needed · share room ID <span className="mono">{room.roomId}</span>
          </p>
        </>
      );
    }
    case "countdown":
      return (
        <>
          <h2 className="big">{state.countdown || "GO"}</h2>
          <p>Round {state.round}</p>
        </>
      );
    case "finished": {
      const winner = [...state.players.values()].find((p) => p.slot === state.winnerSlot);
      const title =
        state.winnerSlot < 0 ? "Draw" : state.winnerSlot === mySlot ? "You win!" : `${winner?.name ?? "Opponent"} wins`;
      return (
        <>
          <h2>{title}</h2>
          <p>Back to the room in {state.countdown}…</p>
        </>
      );
    }
    default:
      return null;
  }
}
