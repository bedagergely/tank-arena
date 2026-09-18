import { useCallback, useState } from "react";
import type { GameRoom } from "./net/client.ts";
import { Home } from "./ui/Home.tsx";
import { RoomScreen } from "./ui/RoomScreen.tsx";

export function App() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const onLeave = useCallback(() => setRoom(null), []);

  return room ? <RoomScreen key={room.roomId} room={room} onLeave={onLeave} /> : <Home onJoined={setRoom} />;
}
