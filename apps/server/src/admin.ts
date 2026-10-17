import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import { createMetrics, type Metrics } from "./metrics.ts";
import { createProfiler, ProfilerStateError, type Profiler } from "./profiler.ts";

export interface AdminConfig {
  /** Whether the panel is mounted at all. */
  enabled: boolean;
  /** Basic-auth username; only meaningful once `password` is set. */
  user: string;
  /** Basic-auth password. When set, the panel sits behind a browser prompt. */
  password?: string;
  /** Directory holding recorded profiles. */
  snapshotDir: string;
}

/**
 * Resolve how the admin panel is exposed from the environment.
 *
 * The panel can capture profiles and read the process heap, so it is never
 * mounted unprotected in production: `ADMIN_PASSWORD` must be set for it to
 * appear at all. Development keeps it open for convenience.
 */
export function resolveAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const password = env.ADMIN_PASSWORD?.trim() || undefined;
  return {
    enabled: env.NODE_ENV !== "production" || password !== undefined,
    user: env.ADMIN_USER?.trim() || "admin",
    password,
    snapshotDir: env.ADMIN_SNAPSHOT_DIR?.trim() || join(tmpdir(), "tank-arena-snapshots"),
  };
}

export interface AdminOptions {
  /** Environment to read the panel configuration from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Profiler to drive; injected by tests. */
  profiler?: Profiler;
  /** Live CPU/memory recorders; injected by tests. */
  metrics?: Metrics;
  /** Built client directory holding `admin.html`. The UI itself lives in apps/client. */
  clientDir?: string;
}

/**
 * Minimal HTTP basic-auth gate for the panel. Colyseus' `basicAuth` is a
 * better-call middleware and cannot wrap a plain express router, so we compare
 * the header ourselves in constant time.
 */
function basicAuth(user: string, password: string): RequestHandler {
  const expected = Buffer.from(`${user}:${password}`, "utf8");
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    if (scheme === "Basic" && encoded) {
      const provided = Buffer.from(encoded, "base64");
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Tank Arena admin"');
    res.status(401).send("Authentication required");
  };
}

/** Wraps an async handler so a rejected promise becomes a JSON error response. */
function handle(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      const conflict = err instanceof ProfilerStateError;
      res.status(conflict ? 409 : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * The profiling panel: start/stop the CPU profiler, capture a heap snapshot,
 * download anything recorded so far, and record live CPU/memory usage.
 *
 * The page itself is a second client build (apps/client/admin.html) served from
 * `clientDir`; this module only owns the API and its auth. Pass the result
 * straight to `app.use("/admin", ...)`, or `null` when the panel is disabled
 * (production without `ADMIN_PASSWORD`).
 */
export function adminMiddleware(options: AdminOptions = {}): Router | null {
  const { enabled, user, password, snapshotDir } = resolveAdminConfig(options.env);
  if (!enabled) return null;

  const panel = options.profiler ?? createProfiler(snapshotDir);
  const metrics = options.metrics ?? createMetrics();
  const router = express.Router();

  if (password) router.use(basicAuth(user, password));

  router.get("/", (_req, res) => {
    const page = options.clientDir === undefined ? null : resolve(options.clientDir, "admin.html");
    if (page === null || !existsSync(page)) {
      res
        .status(503)
        .type("text")
        .send("The admin UI is not built. Run `bun run build`, or open it from the Vite dev server (http://localhost:3000/admin.html).");
      return;
    }
    res.sendFile(page);
  });

  router.get("/status", (_req, res) => {
    res.json({ cpuRunning: panel.cpuRunning });
  });

  // Live CPU/memory recording, sampled by the server so the reading does not
  // depend on how often the page happens to poll.
  router.get("/metrics", handle(async () => metrics.snapshot()));

  router.post("/metrics/cpu/start", handle(async () => {
    metrics.cpu.start();
    return { recording: true };
  }));

  router.post("/metrics/cpu/stop", handle(async () => {
    metrics.cpu.stop();
    return { recording: false };
  }));

  router.post("/metrics/memory/start", handle(async () => {
    metrics.memory.start();
    return { recording: true };
  }));

  router.post("/metrics/memory/stop", handle(async () => {
    metrics.memory.stop();
    return { recording: false };
  }));

  router.post("/metrics/game/start", handle(async () => {
    metrics.game.start();
    return { recording: true };
  }));

  router.post("/metrics/game/stop", handle(async () => {
    metrics.game.stop();
    return { recording: false };
  }));

  router.get("/snapshots", handle(async () => ({ snapshots: await panel.listSnapshots() })));

  router.get("/snapshots/:name", (req, res) => {
    const name = req.params.name ?? "";
    const path = panel.resolveSnapshot(name);
    if (!path) {
      res.status(404).json({ error: "unknown snapshot" });
      return;
    }
    res.download(path, name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "snapshot unavailable" });
    });
  });

  router.post("/cpu/start", handle(async () => {
    await panel.startCpuProfile();
    return { cpuRunning: true };
  }));

  router.post("/cpu/stop", handle(async () => ({ snapshot: await panel.stopCpuProfile(), cpuRunning: false })));

  router.post("/heap/snapshot", handle(async () => ({ snapshot: await panel.takeHeapSnapshot() })));

  return router;
}
