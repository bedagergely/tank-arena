import { useEffect, useState } from "react";
import type { GameRoom } from "../net/client.ts";
import { formatLatency, latencyTone } from "./latency.ts";

const PING_INTERVAL_MS = 2000;

/**
 * Round-trip time to the server, measured with Colyseus' built-in ping (a
 * protocol-level PING the server answers with PONG, so nothing of ours is on
 * the wire). Mounted only while a round is being played, so it never polls
 * from the lobby or the results screens.
 */
export function Latency({ room }: { room: GameRoom }) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const measure = () => room.ping((value) => !cancelled && setMs(value));
    measure();
    const id = setInterval(measure, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [room]);

  return (
    <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs backdrop-blur">
      <span className="text-base-content/60">ping</span>{" "}
      <span className={`font-mono ${latencyTone(ms)}`}>{formatLatency(ms)}</span>
    </span>
  );
}
