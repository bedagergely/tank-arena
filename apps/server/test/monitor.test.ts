import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";

import appConfig from "../src/app.config.ts";
import { monitorMiddleware, resolveMonitorConfig } from "../src/monitor.ts";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

describe("resolveMonitorConfig", () => {
  it("keeps the panel open in development", () => {
    expect(resolveMonitorConfig({ NODE_ENV: "development" })).toEqual({
      enabled: true,
      user: "admin",
      password: undefined,
    });
  });

  it("disables the panel in production without a password", () => {
    expect(resolveMonitorConfig({ NODE_ENV: "production" }).enabled).toBe(false);
  });

  it("enables the panel in production once a password is set", () => {
    expect(resolveMonitorConfig({ NODE_ENV: "production", MONITOR_PASSWORD: "s3cret" })).toEqual({
      enabled: true,
      user: "admin",
      password: "s3cret",
    });
  });

  it("honours a custom user name and trims the password", () => {
    const config = resolveMonitorConfig({ NODE_ENV: "production", MONITOR_PASSWORD: "  s3cret  ", MONITOR_USER: " ops " });
    expect(config).toEqual({ enabled: true, user: "ops", password: "s3cret" });
  });
});

describe("monitorMiddleware", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  /** Mount the panel exactly like app.config.ts does, on an ephemeral port. */
  async function listen(env: NodeJS.ProcessEnv): Promise<string> {
    const app = express();
    const panel = monitorMiddleware(env);
    if (panel) app.use("/monitor", panel);

    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server has no port");
    return `http://127.0.0.1:${address.port}`;
  }

  it("does not mount the panel in production without a password", async () => {
    const base = await listen({ NODE_ENV: "production" });
    const res = await fetch(`${base}/monitor/api`);
    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated requests once a password is set", async () => {
    const base = await listen({ NODE_ENV: "production", MONITOR_PASSWORD: "s3cret" });
    const res = await fetch(`${base}/monitor/api`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects the wrong password", async () => {
    const base = await listen({ NODE_ENV: "production", MONITOR_PASSWORD: "s3cret" });
    const res = await fetch(`${base}/monitor/api`, { headers: { authorization: basic("admin:wrong") } });
    expect(res.status).toBe(401);
  });
});

describe("app.config mounts the panel in production", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    process.env.MONITOR_PASSWORD = "s3cret";
    colyseus = await boot(appConfig);
  });

  afterAll(async () => {
    await colyseus.shutdown();
    delete process.env.MONITOR_PASSWORD;
    process.env.NODE_ENV = "test";
  });

  const url = (path: string) => `http://127.0.0.1:${(colyseus.server as unknown as { port: number }).port}${path}`;

  it("serves the panel to the configured credentials", async () => {
    const res = await fetch(url("/monitor/api"), { headers: { authorization: basic("admin:s3cret") } });
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(url("/monitor/api"));
    expect(res.status).toBe(401);
  });
});
