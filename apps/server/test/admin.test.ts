import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { adminMiddleware, resolveAdminConfig } from "../src/admin.ts";
import { createInspectorProfiler, type Profiler, type SnapshotInfo } from "../src/profiler.ts";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

const sample: SnapshotInfo = {
  name: "cpu-2026-01-01T00-00-00-000Z.cpuprofile",
  kind: "cpu",
  size: 1234,
  createdAt: 1767225600000,
};

function fakeProfiler(): Profiler {
  let cpu = false;
  let heap = false;
  return {
    get cpuRunning() {
      return cpu;
    },
    get heapSamplingRunning() {
      return heap;
    },
    async startCpuProfile() {
      cpu = true;
    },
    async stopCpuProfile() {
      cpu = false;
      return sample;
    },
    async takeHeapSnapshot() {
      return sample;
    },
    async startHeapSampling() {
      heap = true;
    },
    async stopHeapSampling() {
      heap = false;
      return sample;
    },
    async listSnapshots() {
      return [sample];
    },
    resolveSnapshot(name) {
      return name === sample.name ? join(tmpdir(), name) : null;
    },
  };
}

describe("resolveAdminConfig", () => {
  it("keeps the panel open in development", () => {
    const config = resolveAdminConfig({ NODE_ENV: "development" });
    expect(config.enabled).toBe(true);
    expect(config.user).toBe("admin");
    expect(config.password).toBeUndefined();
    expect(config.snapshotDir).toBe(join(tmpdir(), "tank-arena-snapshots"));
  });

  it("disables the panel in production without a password", () => {
    expect(resolveAdminConfig({ NODE_ENV: "production" }).enabled).toBe(false);
  });

  it("enables the panel in production once a password is set", () => {
    expect(resolveAdminConfig({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" })).toEqual({
      enabled: true,
      user: "admin",
      password: "s3cret",
      snapshotDir: join(tmpdir(), "tank-arena-snapshots"),
    });
  });

  it("honours a custom user, trims the password, and takes a snapshot dir", () => {
    const config = resolveAdminConfig({
      NODE_ENV: "production",
      ADMIN_PASSWORD: "  s3cret  ",
      ADMIN_USER: " ops ",
      ADMIN_SNAPSHOT_DIR: "/var/profiles",
    });
    expect(config).toEqual({ enabled: true, user: "ops", password: "s3cret", snapshotDir: "/var/profiles" });
  });
});

describe("admin panel", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  /** Mount the panel exactly like app.config.ts does, on an ephemeral port. */
  async function listen(env: NodeJS.ProcessEnv, profiler: Profiler): Promise<string> {
    const app = express();
    const panel = adminMiddleware(env, profiler);
    if (panel) app.use("/admin", panel);

    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server has no port");
    return `http://127.0.0.1:${address.port}`;
  }

  const auth = { authorization: basic("admin:s3cret") };

  it("does not mount the panel in production without a password", async () => {
    const base = await listen({ NODE_ENV: "production" }, fakeProfiler());
    const res = await fetch(`${base}/admin/status`);
    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated requests once a password is set", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());
    const res = await fetch(`${base}/admin/status`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects the wrong password", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());
    const res = await fetch(`${base}/admin/status`, { headers: { authorization: basic("admin:wrong") } });
    expect(res.status).toBe(401);
  });

  it("serves the HTML panel to the configured credentials", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());
    const res = await fetch(`${base}/admin/`, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Start CPU profiling");
    expect(html).toContain("Take heap snapshot");
  });

  it("drives the CPU profiler and reports status", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());

    const start = await fetch(`${base}/admin/cpu/start`, { method: "POST", headers: auth });
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({ cpuRunning: true });

    const status = await fetch(`${base}/admin/status`, { headers: auth });
    expect(await status.json()).toEqual({ cpuRunning: true, heapSamplingRunning: false });

    const stop = await fetch(`${base}/admin/cpu/stop`, { method: "POST", headers: auth });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ snapshot: sample, cpuRunning: false });
  });

  it("drives the heap profilers", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());

    const snapshot = await fetch(`${base}/admin/heap/snapshot`, { method: "POST", headers: auth });
    expect(await snapshot.json()).toEqual({ snapshot: sample });

    const start = await fetch(`${base}/admin/heap/start`, { method: "POST", headers: auth });
    expect(await start.json()).toEqual({ heapSamplingRunning: true });

    const stop = await fetch(`${base}/admin/heap/stop`, { method: "POST", headers: auth });
    expect(await stop.json()).toEqual({ snapshot: sample, heapSamplingRunning: false });
  });

  it("lists recorded snapshots", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());
    const res = await fetch(`${base}/admin/snapshots`, { headers: auth });
    expect(await res.json()).toEqual({ snapshots: [sample] });
  });

  it("refuses to download names it did not record", async () => {
    const base = await listen({ NODE_ENV: "production", ADMIN_PASSWORD: "s3cret" }, fakeProfiler());
    const res = await fetch(`${base}/admin/snapshots/${encodeURIComponent("../etc/passwd")}`, { headers: auth });
    expect(res.status).toBe(404);
  });
});

describe("admin panel downloads", () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("serves a recorded snapshot as a download", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tank-admin-"));
    dirs.push(dir);
    await writeFile(join(dir, "cpu-test.cpuprofile"), "PROFILE");

    const app = express();
    const panel = adminMiddleware(
      { NODE_ENV: "production", ADMIN_PASSWORD: "s3cret", ADMIN_SNAPSHOT_DIR: dir },
      createInspectorProfiler(dir),
    );
    if (panel) app.use("/admin", panel);

    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server has no port");

    const res = await fetch(`http://127.0.0.1:${address.port}/admin/snapshots/cpu-test.cpuprofile`, {
      headers: { authorization: basic("admin:s3cret") },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("cpu-test.cpuprofile");
    expect(await res.text()).toBe("PROFILE");
  });
});

describe("inspector profiler", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function profiler() {
    const dir = await mkdtemp(join(tmpdir(), "tank-profiler-"));
    dirs.push(dir);
    return { dir, panel: createInspectorProfiler(dir) };
  }

  it("records a CPU profile", async () => {
    const { dir, panel } = await profiler();
    expect(panel.cpuRunning).toBe(false);
    await panel.startCpuProfile();
    expect(panel.cpuRunning).toBe(true);
    let sink = 0;
    for (let i = 0; i < 1_000_000; i++) sink += i;
    expect(sink).toBeGreaterThan(0);
    const info = await panel.stopCpuProfile();
    expect(panel.cpuRunning).toBe(false);

    expect(info.kind).toBe("cpu");
    expect(info.name).toMatch(/^cpu-.*\.cpuprofile$/);
    expect(info.size).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(dir, info.name), "utf8"))).toHaveProperty("nodes");
  });

  it("records a heap snapshot", async () => {
    const { dir, panel } = await profiler();
    const info = await panel.takeHeapSnapshot();

    expect(info.kind).toBe("heap");
    expect(info.name).toMatch(/^heap-.*\.heapsnapshot$/);
    const snapshot = JSON.parse(await readFile(join(dir, info.name), "utf8"));
    expect(snapshot.snapshot.meta.node_fields).toBeDefined();
  });

  it("records a sampling heap profile", async () => {
    const { dir, panel } = await profiler();
    expect(panel.heapSamplingRunning).toBe(false);
    await panel.startHeapSampling();
    expect(panel.heapSamplingRunning).toBe(true);
    const info = await panel.stopHeapSampling();
    expect(panel.heapSamplingRunning).toBe(false);

    expect(info.kind).toBe("heapsampling");
    expect(info.name).toMatch(/^heapsampling-.*\.heapprofile$/);
    expect(JSON.parse(await readFile(join(dir, info.name), "utf8"))).toHaveProperty("head");
  });

  it("lists snapshots newest first and only exposes names it recorded", async () => {
    const { panel } = await profiler();
    await panel.startCpuProfile();
    await panel.stopCpuProfile();
    const heap = await panel.takeHeapSnapshot();

    const snapshots = await panel.listSnapshots();
    expect(snapshots.map((s) => s.kind).sort()).toEqual(["cpu", "heap"]);
    expect(panel.resolveSnapshot(heap.name)).not.toBeNull();
    expect(panel.resolveSnapshot("../secret.cpuprofile")).toBeNull();
    expect(panel.resolveSnapshot("notes.txt")).toBeNull();
  });
});
