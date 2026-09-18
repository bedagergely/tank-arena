import { useEffect, useReducer, useState } from "react";
import type { Room } from "@colyseus/sdk";
import type { ChatMessage, SystemMessage } from "@tank-arena/shared";
import { GAME_ROOM, sdk, type GameRoom, type RoomListing } from "./client.ts";

/** Re-render whenever the room's synchronised state receives a patch. */
export function useRoomState(room: GameRoom): number {
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  useEffect(() => {
    const handler = () => bump();
    room.onStateChange(handler);
    return () => room.onStateChange.remove(handler);
  }, [room]);
  return version;
}

export interface FeedEntry {
  id: number;
  kind: "chat" | "system";
  name?: string;
  from?: string;
  text: string;
  at: number;
}

const MAX_FEED = 200;

/** Client-side chat feed. The server relays chat only; this is the only copy. */
export function useChatFeed(room: GameRoom): FeedEntry[] {
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  useEffect(() => {
    let nextId = 1;
    const push = (entry: Omit<FeedEntry, "id">) =>
      setFeed((prev) => [...prev, { ...entry, id: nextId++ }].slice(-MAX_FEED));

    const offChat = room.onMessage("chat", (m: ChatMessage) =>
      push({ kind: "chat", name: m.name, from: m.from, text: m.text, at: m.at }),
    );
    const offSystem = room.onMessage("system", (m: SystemMessage) => push({ kind: "system", text: m.text, at: m.at }));
    return () => {
      offChat();
      offSystem();
    };
  }, [room]);
  return feed;
}

/** Live list of open game rooms via Colyseus' LobbyRoom. */
export function useRoomListing(enabled: boolean): { rooms: RoomListing[]; error: string | null } {
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let lobby: Room | undefined;
    let cancelled = false;

    sdk
      .joinOrCreate("lobby")
      .then((room) => {
        if (cancelled) {
          void room.leave();
          return;
        }
        lobby = room;
        setError(null);
        room.onMessage("rooms", (list: RoomListing[]) => setRooms(list.filter((r) => r.name === GAME_ROOM)));
        room.onMessage("+", ([roomId, data]: [string, RoomListing]) => {
          if (data.name !== GAME_ROOM) return;
          setRooms((prev) => [...prev.filter((r) => r.roomId !== roomId), data]);
        });
        room.onMessage("-", (roomId: string) => setRooms((prev) => prev.filter((r) => r.roomId !== roomId)));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      void lobby?.leave();
    };
  }, [enabled]);

  return { rooms, error };
}
