/**
 * Bot cost benchmark. Run with `bun run bench` from packages/shared.
 *
 * The shot planner dominates a bot match's CPU, so this reports the two numbers
 * that move when it changes: how many angles a decision traces, and how long a
 * simulated second of a four-tank bot game costs.
 */
import { createBot, createJsEngine, DEFAULT_RULES, findShot, listMaps, shotCandidates, thinkBot } from "../src/index.ts";

const rules = { ...DEFAULT_RULES, loot: { ...DEFAULT_RULES.loot, enabled: false } };
const SLOTS = [0, 1, 2, 3];
const SECONDS = 10;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

console.log("map           walls  angles/decision  findShot  sim-second  realtime");
for (const map of listMaps()) {
  const probe = createJsEngine(map, rules);
  probe.reset(SLOTS, 1);
  const shooter = probe.world.tanks[0]!;
  const target = probe.world.tanks[1]!;
  const angles = shotCandidates(shooter, target, map, rules).length;

  for (let i = 0; i < 200; i++) findShot(probe.world, map, rules, shooter, target, 3);
  const samples: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    findShot(probe.world, map, rules, shooter, target, 3);
    samples.push((performance.now() - t0) * 1000);
  }

  const engine = createJsEngine(map, rules);
  engine.reset(SLOTS, 7);
  const bots = SLOTS.map((slot) => createBot(slot, "hard", 42 + slot));
  const dt = 1 / rules.tickRate;
  const started = performance.now();
  for (let t = 0; t < SECONDS; t += dt) {
    for (const bot of bots) engine.setInput(bot.slot, thinkBot(bot, engine.world, engine.map, rules, dt));
    engine.step(dt);
  }
  const elapsed = performance.now() - started;

  console.log(
    `${map.id.padEnd(13)} ${String(map.walls.length).padStart(5)} ${String(angles).padStart(16)} ${`${median(samples).toFixed(0)}µs`.padStart(9)} ${`${(elapsed / SECONDS).toFixed(1)}ms`.padStart(11)} ${`${(SECONDS / (elapsed / 1000)).toFixed(0)}x`.padStart(8)}`,
  );
}
