import { useCallback, useState, type ReactNode } from "react";
import { DEFAULT_MAP_ID } from "@tank-arena/shared";
import { App } from "../App.tsx";
import { ARROW_BINDINGS, KeyBindingsContext, WASD_BINDINGS, type KeyBindings } from "../game/keyBindings.ts";
import type { GameRoom } from "../net/client.ts";

/**
 * Dev-only harness: two independent clients on one page, each with its own key
 * layout so both tanks can be driven from a single keyboard. Player 1 creates a
 * room, Player 2 joins it, and both are marked ready so the first round starts on
 * its own. Available in `pnpm dev` at http://localhost:3000/?split — options:
 * `&map=<id>` picks the map, `&manual` skips the auto-ready.
 */
export function SplitScreen() {
  const params = new URLSearchParams(window.location.search);
  const mapId = params.get("map") ?? DEFAULT_MAP_ID;
  const autoReady = !params.has("manual");
  const [hostRoomId, setHostRoomId] = useState<string | null>(null);

  const onHostRoom = useCallback(
    (room: GameRoom | null) => {
      setHostRoomId(room?.roomId ?? null);
      if (room && autoReady) room.send("ready", { ready: true });
    },
    [autoReady],
  );
  const onGuestRoom = useCallback(
    (room: GameRoom | null) => {
      if (room && autoReady) room.send("ready", { ready: true });
    },
    [autoReady],
  );

  return (
    <div className="split">
      <Pane title="Player 1" bindings={WASD_BINDINGS}>
        <App initialRequest={{ kind: "create", options: { name: "Player 1", mapId } }} onRoom={onHostRoom} />
      </Pane>
      <Pane title="Player 2" bindings={ARROW_BINDINGS}>
        {hostRoomId ? (
          <App
            key={hostRoomId}
            initialRequest={{ kind: "join", roomId: hostRoomId, options: { name: "Player 2" } }}
            onRoom={onGuestRoom}
          />
        ) : (
          <main className="room">
            <p className="muted">Waiting for Player 1 to create a room…</p>
          </main>
        )}
      </Pane>
    </div>
  );
}

interface PaneProps {
  title: string;
  bindings: KeyBindings;
  children: ReactNode;
}

function Pane({ title, bindings, children }: PaneProps) {
  return (
    <section className="split-pane">
      <header className="split-header">
        <strong>{title}</strong>
        <span className="muted">{bindings.hint}</span>
      </header>
      <KeyBindingsContext.Provider value={bindings}>{children}</KeyBindingsContext.Provider>
    </section>
  );
}
