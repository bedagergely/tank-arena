/**
 * Room lifecycle logging. Every line shares one prefix so a single `docker logs`
 * stream stays greppable, and the test runner stays quiet.
 */

const PREFIX = "[tank-arena]";

/** Format one lifecycle line. Pure, so the shape is testable. */
export function formatRoomLog(roomId: string, message: string): string {
  return `${PREFIX} room=${roomId} ${message}`;
}

export function roomLog(roomId: string, message: string): void {
  if (process.env.NODE_ENV === "test") return;
  console.log(formatRoomLog(roomId, message));
}
