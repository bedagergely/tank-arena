import { useCallback, useState } from "react";
import { useRoom } from "@colyseus/react";
import { connect, type JoinRequest } from "./net/client.ts";
import { Home } from "./ui/Home.tsx";
import { RoomScreen } from "./ui/RoomScreen.tsx";

export function App() {
  const [request, setRequest] = useState<JoinRequest | null>(null);
  // `useRoom` owns the connection: it connects when a request is set, leaves when it is
  // cleared or replaced, and survives StrictMode's double mount without duplicate joins.
  const { room, error, isConnecting } = useRoom(request && (() => connect(request)), [request]);
  const onLeave = useCallback(() => setRequest(null), []);

  return room ? (
    <RoomScreen key={room.roomId} room={room} onLeave={onLeave} />
  ) : (
    <Home onJoin={setRequest} busy={isConnecting} error={error} />
  );
}
