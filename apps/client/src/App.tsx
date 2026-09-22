import { useCallback, useEffect, useState } from "react";
import { useRoom } from "@colyseus/react";
import { connect, type GameRoom, type JoinRequest } from "./net/client.ts";
import { Home } from "./ui/Home.tsx";
import { RoomScreen } from "./ui/RoomScreen.tsx";

interface Props {
  /** Skip the home screen and connect immediately (used by the dev split-screen). */
  initialRequest?: JoinRequest;
  onRoom?: (room: GameRoom | null) => void;
}

export function App({ initialRequest, onRoom }: Props) {
  const [request, setRequest] = useState<JoinRequest | null>(initialRequest ?? null);
  // `useRoom` owns the connection: it connects when a request is set, leaves when it is
  // cleared or replaced, and survives StrictMode's double mount without duplicate joins.
  const { room, error, isConnecting } = useRoom(request && (() => connect(request)), [request]);
  const onLeave = useCallback(() => setRequest(null), []);

  useEffect(() => {
    onRoom?.(room ?? null);
  }, [room, onRoom]);

  return room ? (
    <RoomScreen key={room.roomId} room={room} onLeave={onLeave} />
  ) : (
    <Home onJoin={setRequest} busy={isConnecting} error={error} />
  );
}
