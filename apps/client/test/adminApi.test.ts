import { afterEach, describe, expect, it } from "bun:test";
import { getMetrics, getStatus, startGameRecording } from "../src/admin/api.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture the RequestInit of every call and answer with an empty JSON body. */
function stubFetch(): RequestInit[] {
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

describe("admin api", () => {
  it("sends a body on POST so the Bun transport does not reject it", async () => {
    const calls = stubFetch();
    await startGameRecording();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toBeTruthy();
  });

  it("leaves GET requests without a body", async () => {
    const calls = stubFetch();
    await getStatus();
    await getMetrics();

    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(calls.every((call) => call.body === undefined)).toBe(true);
  });
});
