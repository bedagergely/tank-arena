import { Application, Container, Graphics, Text, type Ticker } from "pixi.js";
import {
  PERK_BULLET_SPEED,
  PERK_BULLETS,
  PERK_SHIELD,
  PERK_TANK_SPEED,
  isPerkId,
  type GameEventMessage,
  type GameMap,
  type PerkId,
} from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";
import { playBeep } from "./Sound.ts";

export const SLOT_COLORS = [0x4fc3f7, 0xff8a65, 0x81c784, 0xffd54f, 0xba68c8, 0x90a4ae];

const BG = 0x11151c;
const WALL = 0x3a4556;
const WALL_EDGE = 0x556274;
const FLOOR = 0x1a2029;

export const PERK_COLORS: Readonly<Record<PerkId, number>> = {
  [PERK_BULLETS]: 0xffb74d,
  [PERK_BULLET_SPEED]: 0xff5252,
  [PERK_TANK_SPEED]: 0x69f0ae,
  [PERK_SHIELD]: 0x40c4ff,
};
const PERK_GLYPHS: Readonly<Record<PerkId, string>> = {
  [PERK_BULLETS]: "•••",
  [PERK_BULLET_SPEED]: "»",
  [PERK_TANK_SPEED]: "≫",
  [PERK_SHIELD]: "◯",
};
const LOOT_SIZE = 20;

/** How fast displayed positions chase the server state (1/s). */
const LERP_RATE = 18;

interface TankView {
  root: Container;
  body: Graphics;
  shield: Graphics;
  label: Text;
  x: number;
  y: number;
  angle: number;
}

interface LootView {
  root: Container;
  spin: number;
}

interface BulletView {
  g: Graphics;
  x: number;
  y: number;
}

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
}

/**
 * Pure presentation: reads the authoritative room state every frame and
 * smooths toward it. Never simulates gameplay itself.
 */
export class GameRenderer {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly fxLayer = new Container();
  private readonly tanks = new Map<number, TankView>();
  private readonly bullets = new Map<number, BulletView>();
  private readonly loot = new Map<number, LootView>();
  private readonly particles: Particle[] = [];
  private elapsed = 0;
  private readonly offEvent: () => void;
  private destroyed = false;

  private constructor(
    private readonly room: GameRoom,
    private readonly map: GameMap,
  ) {
    this.offEvent = room.onMessage("event", (e: GameEventMessage) => this.onEvent(e));
  }

  static async mount(host: HTMLElement, room: GameRoom, map: GameMap): Promise<GameRenderer> {
    const r = new GameRenderer(room, map);
    await r.app.init({
      width: map.width,
      height: map.height,
      background: BG,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    if (r.destroyed) {
      r.app.destroy(true);
      return r;
    }
    host.appendChild(r.app.canvas);
    r.app.canvas.classList.add("game-canvas");

    r.world.addChild(r.buildMap());
    r.world.addChild(r.fxLayer);
    r.app.stage.addChild(r.world);
    r.app.ticker.add(r.tick);
    return r;
  }

  destroy() {
    this.destroyed = true;
    this.offEvent();
    if (this.app.renderer) {
      this.app.ticker.remove(this.tick);
      this.app.destroy(true, { children: true });
    }
  }

  private buildMap(): Graphics {
    const g = new Graphics();
    g.rect(0, 0, this.map.width, this.map.height).fill(FLOOR);
    for (const w of this.map.walls) {
      g.rect(w.x, w.y, w.width, w.height).fill(WALL);
      // Light top/left edge for a bit of depth.
      g.rect(w.x, w.y, w.width, Math.min(1, w.height)).fill(WALL_EDGE);
      g.rect(w.x, w.y, Math.min(1, w.width), w.height).fill(WALL_EDGE);
    }
    return g;
  }

  private readonly tick = (ticker: Ticker) => {
    const dt = ticker.deltaMS / 1000;
    const k = 1 - Math.exp(-LERP_RATE * dt);
    this.elapsed += dt;
    this.syncLoot(dt);
    this.syncTanks(k);
    this.syncBullets(k);
    this.updateParticles(dt);
  };

  private syncTanks(k: number) {
    const state = this.room.state;
    const names = new Map<number, string>();
    for (const p of state.players.values()) if (p.slot >= 0) names.set(p.slot, p.name);
    const seen = new Set<number>();
    for (const t of state.tanks.values()) {
      seen.add(t.slot);
      let view = this.tanks.get(t.slot);
      if (!view) {
        view = this.createTank(t.slot, t.x, t.y, t.angle);
        this.tanks.set(t.slot, view);
      }
      view.x += (t.x - view.x) * k;
      view.y += (t.y - view.y) * k;
      view.angle += shortestAngle(view.angle, t.angle) * k;
      view.root.position.set(view.x, view.y);
      view.body.rotation = view.angle;
      view.root.alpha = t.alive ? 1 : 0.35;
      const name = names.get(t.slot) ?? `P${t.slot + 1}`;
      if (view.label.text !== name) view.label.text = name;

      view.shield.visible = t.perkShield > 0;
      if (view.shield.visible) {
        view.shield.alpha = 0.55 + 0.35 * Math.sin(this.elapsed * 6);
        view.shield.rotation = this.elapsed * 1.5;
      }
      view.body.tint = t.perkTankSpeed > 0 ? 0xd8ffe8 : 0xffffff;
    }
    for (const [slot, view] of this.tanks) {
      if (seen.has(slot)) continue;
      view.root.destroy({ children: true });
      this.tanks.delete(slot);
    }
  }

  private syncBullets(k: number) {
    const state = this.room.state;
    const seen = new Set<number>();
    for (const b of state.bullets.values()) {
      seen.add(b.id);
      let view = this.bullets.get(b.id);
      if (!view) {
        const radius = state.bulletRadius;
        const g = new Graphics().circle(0, 0, radius).fill(0xffffff);
        g.circle(0, 0, radius * 2).fill({ color: colorFor(b.ownerSlot), alpha: 0.25 });
        this.world.addChild(g);
        view = { g, x: b.x, y: b.y };
        this.bullets.set(b.id, view);
      }
      view.x += (b.x - view.x) * k;
      view.y += (b.y - view.y) * k;
      view.g.position.set(view.x, view.y);
    }
    for (const [id, view] of this.bullets) {
      if (seen.has(id)) continue;
      view.g.destroy();
      this.bullets.delete(id);
    }
  }

  private syncLoot(dt: number) {
    const state = this.room.state;
    const seen = new Set<number>();
    for (const box of state.loot.values()) {
      if (!isPerkId(box.perk)) continue;
      seen.add(box.id);
      let view = this.loot.get(box.id);
      if (!view) {
        view = this.createLoot(box.x, box.y, box.perk);
        this.loot.set(box.id, view);
      }
      view.spin += dt * 1.2;
      view.root.scale.set(1 + 0.08 * Math.sin(view.spin * 3));
    }
    for (const [id, view] of this.loot) {
      if (seen.has(id)) continue;
      view.root.destroy({ children: true });
      this.loot.delete(id);
    }
  }

  private createLoot(x: number, y: number, perk: PerkId): LootView {
    const color = PERK_COLORS[perk];
    const half = LOOT_SIZE / 2;
    const box = new Graphics();
    box.circle(0, 0, half * 1.6).fill({ color, alpha: 0.18 });
    box.roundRect(-half, -half, LOOT_SIZE, LOOT_SIZE, 4).fill(0x232b36).stroke({ color, width: 2 });
    const glyph = new Text({
      text: PERK_GLYPHS[perk],
      style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fontWeight: "bold", fill: color },
    });
    glyph.anchor.set(0.5);
    const root = new Container();
    root.addChild(box, glyph);
    root.position.set(x, y);
    this.world.addChild(root);
    this.burst(x, y, color, 10, 50);
    return { root, spin: Math.random() * Math.PI * 2 };
  }

  private createTank(slot: number, x: number, y: number, angle: number): TankView {
    const r = this.room.state.tankRadius;
    const color = colorFor(slot);
    const body = new Graphics();
    body.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 3).fill(color);
    body.rect(-r, -r, r * 2, r * 0.25).fill({ color: 0x000000, alpha: 0.35 });
    body.rect(-r, r * 0.75, r * 2, r * 0.25).fill({ color: 0x000000, alpha: 0.35 });
    body.circle(0, 0, r * 0.55).fill({ color, alpha: 1 }).stroke({ color: 0x000000, alpha: 0.4, width: 2 });
    body.rect(0, -3, r * 1.6, 6).fill(0xe0e0e0);

    const label = new Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0xdddddd },
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, -r - 6);

    const shield = new Graphics();
    shield.circle(0, 0, r + 6).stroke({ color: PERK_COLORS[PERK_SHIELD], width: 2.5 });
    shield.circle(0, 0, r + 6).fill({ color: PERK_COLORS[PERK_SHIELD], alpha: 0.12 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      shield.circle(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6), 2).fill(0xffffff);
    }
    shield.visible = false;

    const root = new Container();
    root.addChild(shield, body, label);
    root.position.set(x, y);
    this.world.addChild(root);
    return { root, body, shield, label, x, y, angle };
  }

  private onEvent(e: GameEventMessage) {
    switch (e.type) {
      case "fire": {
        const t = this.tanks.get(e.slot);
        if (t) {
          this.burst(t.x + Math.cos(t.angle) * 20, t.y + Math.sin(t.angle) * 20, 0xfff3b0, 6, 90);
          playBeep();
        } 
        break;
      }
      case "bounce":
        this.burst(e.x, e.y, 0xffffff, 5, 60);
        break;
      case "hit": {
        const t = this.tanks.get(e.targetSlot);
        if (t) this.burst(t.x, t.y, colorFor(e.targetSlot), 28, 160);
        break;
      }
      case "shield-block": {
        const t = this.tanks.get(e.targetSlot);
        if (t) this.burst(t.x, t.y, PERK_COLORS[PERK_SHIELD], 18, 120);
        break;
      }
      case "loot-pickup": {
        const t = this.tanks.get(e.slot);
        if (t) this.burst(t.x, t.y, PERK_COLORS[e.perk], 14, 80);
        break;
      }
      case "loot-spawn":
        break;
    }
  }

  private burst(x: number, y: number, color: number, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const g = new Graphics().circle(0, 0, 1.5 + Math.random() * 2).fill(color);
      g.position.set(x, y);
      this.fxLayer.addChild(g);
      this.particles.push({ g, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.3 });
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.g.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.alpha = Math.min(1, p.life * 3);
    }
  }
}

export function colorFor(slot: number): number {
  return SLOT_COLORS[slot % SLOT_COLORS.length]!;
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
