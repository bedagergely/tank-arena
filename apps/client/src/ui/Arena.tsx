import { useEffect, useRef } from "react";
import {
  PERK_BULLET_SPEED,
  PERK_BULLETS,
  PERK_NAMES,
  PERK_SHIELD,
  PERK_TANK_SPEED,
  winsNeeded,
  type GameMap,
  type PerkId,
} from "@tank-arena/shared";
import { colorFor, GameRenderer } from "../game/GameRenderer.ts";
import { cssColor } from "./PlayerList.tsx";
import { useKeyboardInput } from "../game/useKeyboardInput.ts";
import type { GameRoom, GameStateSnapshot } from "../net/client.ts";

interface Props {
  room: GameRoom;
  /** Snapshot for React rendering; the PixiJS renderer reads the live `room.state` itself. */
  state: GameStateSnapshot;
  map: GameMap;
}

/** Hosts the PixiJS canvas and the overlay for non-playing phases. */
export function Arena({ room, state, map }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

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

  const me = state.players[room.sessionId];
  const mySlot = me?.slot ?? -1;
  const overlay = overlayFor(room, state, mySlot);
  const myTank = state.phase === "playing" ? state.tanks[String(mySlot)] : undefined;

  return (
    <div className="arena" style={{ width: map.width, height: map.height }}>
      <div ref={hostRef} className="arena-canvas" />
      {state.phase !== "lobby" && <Scoreboard state={state} />}
      {myTank && <PerkBar tank={myTank} />}
      {overlay && <div className="arena-overlay">{overlay}</div>}
    </div>
  );
}

function Scoreboard({ state }: { state: GameStateSnapshot }) {
  const seated = Object.values(state.players)
    .filter((p) => p.slot >= 0)
    .sort((a, b) => a.slot - b.slot);
  return (
    <div className="scoreboard">
      {seated.map((p) => (
        <span key={p.sessionId} className="score">
          <span className="swatch" style={{ background: cssColor(colorFor(p.slot)) }} />
          {p.wins}
        </span>
      ))}
      <span className="muted">first to {winsNeeded(state.rounds)}</span>
    </div>
  );
}

type TankSnapshot = GameStateSnapshot["tanks"][string];

const PERK_TIMERS: ReadonlyArray<[PerkId, (t: TankSnapshot) => number]> = [
  [PERK_BULLETS, (t) => t.perkBullets],
  [PERK_BULLET_SPEED, (t) => t.perkBulletSpeed],
  [PERK_TANK_SPEED, (t) => t.perkTankSpeed],
  [PERK_SHIELD, (t) => t.perkShield],
];

/** The local player's active perks with seconds remaining; driven by authoritative tank state. */
function PerkBar({ tank }: { tank: TankSnapshot }) {
  const active = PERK_TIMERS.filter(([, read]) => read(tank) > 0);
  if (active.length === 0) return null;
  return (
    <div className="perks">
      {active.map(([perk, read]) => (
        <span key={perk} className={`perk perk-${perk}`}>
          {PERK_NAMES[perk]} <span className="mono">{Math.ceil(read(tank))}s</span>
        </span>
      ))}
    </div>
  );
}

function overlayFor(room: GameRoom, state: GameStateSnapshot, mySlot: number) {
  switch (state.phase) {
    case "lobby": {
      const seated = Object.values(state.players).filter((p) => p.slot >= 0).length;
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
          <p>
            Round {state.round} of {state.rounds}
          </p>
        </>
      );
    case "finished": {
      return (
        <>
          <h2>{resultTitle(state, state.winnerSlot, mySlot, "round")}</h2>
          <p>{scoreline(state)}</p>
          <p>Next round in {state.countdown}…</p>
        </>
      );
    }
    case "match-over": {
      return (
        <>
          <h2>{resultTitle(state, state.matchWinnerSlot, mySlot, "match")}</h2>
          <p>{scoreline(state)}</p>
          <p>Back to the room in {state.countdown}…</p>
        </>
      );
    }
    default:
      return null;
  }
}

function resultTitle(state: GameStateSnapshot, winnerSlot: number, mySlot: number, what: "round" | "match") {
  if (winnerSlot < 0) return what === "round" ? "Round drawn" : "Match drawn";
  if (winnerSlot === mySlot) return what === "round" ? "You win the round!" : "You win the match!";
  const winner = Object.values(state.players).find((p) => p.slot === winnerSlot);
  return `${winner?.name ?? "Opponent"} wins the ${what}`;
}

function scoreline(state: GameStateSnapshot) {
  return Object.values(state.players)
    .filter((p) => p.slot >= 0)
    .sort((a, b) => a.slot - b.slot)
    .map((p) => `${p.name} ${p.wins}`)
    .join(" · ");
}
