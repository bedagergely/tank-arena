/**
 * Web Audio helpers. A single shared AudioContext is created lazily and resumed
 * on first use (browsers require a user gesture before audio can play).
 */
let shared: AudioContext | undefined;

function context(): AudioContext {
  if (!shared) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    shared = new Ctor();
  }
  if (shared.state === "suspended") void shared.resume();
  return shared;
}

/** Short cannon-ish blip used for shots. */
export function playBeep(frequency = 140, duration = 0.06) {
  const ctx = context();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(frequency, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.55), t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/**
 * A continuous engine/motor voice for one tank. Two detuned oscillators run
 * through a lowpass filter; throttle (0..1) drives both volume and pitch so it
 * rumbles while moving and falls silent when the tank stops.
 */
export class EngineSound {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly oscA: OscillatorNode;
  private readonly oscB: OscillatorNode;
  private running = false;

  constructor() {
    this.ctx = context();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 420;
    this.filter.Q.value = 7;
    this.oscA = this.ctx.createOscillator();
    this.oscA.type = "sawtooth";
    this.oscA.frequency.value = 46;
    this.oscB = this.ctx.createOscillator();
    this.oscB.type = "square";
    this.oscB.frequency.value = 49;
    this.oscA.connect(this.filter);
    this.oscB.connect(this.filter);
    this.filter.connect(this.master).connect(this.ctx.destination);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.oscA.start();
    this.oscB.start();
  }

  /** throttle in 0..1; 0 silences the engine. */
  setThrottle(throttle: number) {
    const t = this.ctx.currentTime;
    const x = Math.max(0, Math.min(1, throttle));
    if (x <= 0.001) {
      this.master.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    this.master.gain.setTargetAtTime(0.03 + 0.05 * x, t, 0.06);
    const base = 46 + x * 46;
    this.oscA.frequency.setTargetAtTime(base, t, 0.05);
    this.oscB.frequency.setTargetAtTime(base * 1.07 + 2, t, 0.05);
    this.filter.frequency.setTargetAtTime(380 + x * 1100, t, 0.05);
  }

  destroy() {
    if (!this.running) return;
    this.running = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.05);
    try {
      this.oscA.stop(t + 0.3);
      this.oscB.stop(t + 0.3);
    } catch {
      /* already stopped */
    }
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.filter.disconnect();
    this.master.disconnect();
  }
}
