import { Session } from "node:inspector";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { createJsEngine, DEFAULT_RULES, getMap } from "@tank-arena/shared";

const mode = process.argv[2] ?? "none";
const session = new Session();
session.connect();
const post = (method: string, params?: object) =>
  new Promise((resolve, reject) =>
    session.post(method, params ?? {}, (err: Error | null, result?: unknown) =>
      err ? reject(err) : resolve(result),
    ),
  );

if (mode === "profile") {
  await post("Profiler.enable");
  await post("Profiler.start");
} else if (mode === "cov-fn") {
  await post("Profiler.enable");
  await post("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
}

const engine = createJsEngine(getMap("crossroads"), DEFAULT_RULES);
const DT = 1 / 30;
const TICK_MS = 1000 / 30;

let ticks = 0;
let worstLateness = 0;
let lateSum = 0;

const delay = monitorEventLoopDelay({ resolution: 5 });
delay.enable();

const started = performance.now();
let expected = started + TICK_MS;
const timer = setInterval(() => {
  engine.reset([0, 1], ticks);
  engine.setInput(0, { throttle: 1, turn: 0.3, fire: ticks % 20 === 0 });
  engine.setInput(1, { throttle: -1, turn: -0.2, fire: ticks % 17 === 0 });
  engine.step(DT);

  const now = performance.now();
  const late = now - expected;
  lateSum += late;
  if (late > worstLateness) worstLateness = late;
  expected = now + TICK_MS;
  ticks++;
}, TICK_MS);

await new Promise((r) => setTimeout(r, 6000));
clearInterval(timer);
delay.disable();

console.log(
  `${mode.padEnd(10)} ticks=${ticks}  mean lateness ${(lateSum / ticks).toFixed(2)} ms  worst ${worstLateness.toFixed(1)} ms` +
    `  | event loop delay mean ${(delay.mean / 1e6).toFixed(2)} ms  p99 ${(delay.percentile(99) / 1e6).toFixed(2)} ms  max ${(delay.max / 1e6).toFixed(1)} ms`,
);
