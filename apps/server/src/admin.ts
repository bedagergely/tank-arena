import { timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import { createInspectorProfiler, ProfilerStateError, type Profiler } from "./profiler.ts";

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
 * The admin profiling panel: start/stop the CPU and heap profilers, capture a
 * heap snapshot, and download anything recorded so far.
 *
 * Pass the result straight to `app.use("/admin", ...)`, or `null` when the
 * panel is disabled (production without `ADMIN_PASSWORD`).
 */
export function adminMiddleware(env: NodeJS.ProcessEnv = process.env, profiler?: Profiler): Router | null {
  const { enabled, user, password, snapshotDir } = resolveAdminConfig(env);
  if (!enabled) return null;

  const panel = profiler ?? createInspectorProfiler(snapshotDir);
  const router = express.Router();

  if (password) router.use(basicAuth(user, password));

  router.get("/", (_req, res) => {
    res.type("html").send(renderPage());
  });

  router.get("/status", (_req, res) => {
    res.json({ cpuRunning: panel.cpuRunning, heapSamplingRunning: panel.heapSamplingRunning });
  });

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

  router.post("/heap/start", handle(async () => {
    await panel.startHeapSampling();
    return { heapSamplingRunning: true };
  }));

  router.post("/heap/stop", handle(async () => ({
    snapshot: await panel.stopHeapSampling(),
    heapSamplingRunning: false,
  })));

  return router;
}

function renderPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tank Arena · Profiling</title>
    <style>
      :root { color-scheme: dark; }
      body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 900px; padding: 2rem 1.5rem; background: #14161a; color: #e8eaed; }
      h1 { font-size: 1.4rem; }
      button { font: inherit; padding: .5rem .9rem; margin: 0 .5rem .5rem 0; border-radius: .5rem; border: 1px solid #3a3f4b; background: #232733; color: inherit; cursor: pointer; }
      button:hover { background: #2c3140; }
      button:disabled { opacity: .5; cursor: progress; }
      button.running { border-color: #d9534f; background: #3a2323; }
      #message { min-height: 1.5em; color: #9aa0a6; }
      #message.error { color: #ff7b72; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #2a2f3a; }
      th { color: #9aa0a6; font-weight: 600; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      a { color: #7ab8ff; }
    </style>
  </head>
  <body>
    <h1>Profiling</h1>
    <p>
      <button id="cpu">Start CPU profiling</button>
      <button id="heap">Start heap sampling</button>
      <button id="snapshot">Take heap snapshot</button>
    </p>
    <p id="message"></p>
    <table>
      <thead>
        <tr><th>Snapshot</th><th>Type</th><th class="num">Size</th><th>Created</th><th></th></tr>
      </thead>
      <tbody></tbody>
    </table>
    <script>
      var BASE = location.pathname.replace(/\\/+$/, "");
      var message = document.getElementById("message");
      var buttons = {
        cpu: document.getElementById("cpu"),
        heap: document.getElementById("heap"),
        snapshot: document.getElementById("snapshot"),
      };
      var KINDS = { cpu: "CPU profile", heap: "Heap snapshot", heapsampling: "Heap sampling profile" };

      function setMessage(text, isError) {
        message.textContent = text;
        message.classList.toggle("error", Boolean(isError));
      }

      function api(path, method) {
        return fetch(BASE + path, { method: method || "GET" }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (!res.ok) throw new Error(body.error || res.statusText);
            return body;
          });
        });
      }

      function formatBytes(n) {
        if (n < 1024) return n + " B";
        if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
        return (n / 1048576).toFixed(1) + " MB";
      }

      function render(snapshots) {
        var tbody = document.querySelector("tbody");
        tbody.textContent = "";
        if (!snapshots.length) {
          var empty = document.createElement("tr");
          var cell = document.createElement("td");
          cell.colSpan = 5;
          cell.textContent = "No snapshots yet.";
          empty.appendChild(cell);
          tbody.appendChild(empty);
          return;
        }
        snapshots.forEach(function (s) {
          var tr = document.createElement("tr");
          var name = document.createElement("td");
          name.textContent = s.name;
          var kind = document.createElement("td");
          kind.textContent = KINDS[s.kind] || s.kind;
          var size = document.createElement("td");
          size.className = "num";
          size.textContent = formatBytes(s.size);
          var created = document.createElement("td");
          created.textContent = new Date(s.createdAt).toLocaleString();
          var link = document.createElement("td");
          var anchor = document.createElement("a");
          anchor.href = BASE + "/snapshots/" + encodeURIComponent(s.name);
          anchor.setAttribute("download", s.name);
          anchor.textContent = "Download";
          link.appendChild(anchor);
          tr.append(name, kind, size, created, link);
          tbody.appendChild(tr);
        });
      }

      function renderStatus(status) {
        buttons.cpu.textContent = status.cpuRunning ? "Stop CPU profiling" : "Start CPU profiling";
        buttons.cpu.classList.toggle("running", status.cpuRunning);
        buttons.heap.textContent = status.heapSamplingRunning ? "Stop heap sampling" : "Start heap sampling";
        buttons.heap.classList.toggle("running", status.heapSamplingRunning);
      }

      function refresh() {
        return Promise.all([api("/status"), api("/snapshots")]).then(function (results) {
          renderStatus(results[0]);
          render(results[1].snapshots);
        });
      }

      function run(button, path, busy) {
        button.disabled = true;
        setMessage(busy + "…");
        return api(path, "POST")
          .then(function () { return refresh(); })
          .then(function () { setMessage(""); })
          .catch(function (err) { setMessage(err.message, true); })
          .then(function () { button.disabled = false; });
      }

      buttons.cpu.addEventListener("click", function () {
        var running = buttons.cpu.classList.contains("running");
        run(buttons.cpu, running ? "/cpu/stop" : "/cpu/start", running ? "Stopping CPU profiling" : "Starting CPU profiling");
      });

      buttons.heap.addEventListener("click", function () {
        var running = buttons.heap.classList.contains("running");
        run(buttons.heap, running ? "/heap/stop" : "/heap/start", running ? "Stopping heap sampling" : "Starting heap sampling");
      });

      buttons.snapshot.addEventListener("click", function () {
        run(buttons.snapshot, "/heap/snapshot", "Taking heap snapshot");
      });

      refresh().catch(function (err) { setMessage(err.message, true); });
    </script>
  </body>
</html>
`;
}
