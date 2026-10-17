import { describe, expect, it } from "vitest";
import { formatRoomLog } from "../src/logger.ts";

describe("formatRoomLog", () => {
  it("prefixes every line with the service tag and the room id", () => {
    expect(formatRoomLog("abc123", "created map=labyrinth")).toBe("[tank-arena] room=abc123 created map=labyrinth");
  });
});
