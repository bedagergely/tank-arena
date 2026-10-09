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

/** Shared loop of white noise, the raw material for engine and blast texture. */
let noiseCache: AudioBuffer | undefined;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache = buffer;
  return buffer;
}

/**
 * Tank cannon: a deep pressure thump layered under a short broadband blast,
 * rather than a single swept tone. Closer to a recorded gun than a beep.
 */
export function playCannon() {
  const ctx = context();
  const t = ctx.currentTime;

  // Muzzle "thump": a fast low sine drop.
  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(130, t);
  thump.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.0001, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.7, t + 0.006);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(t);
  thump.stop(t + 0.26);

  // Report: a noise burst whose filter closes as the blast decays.
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const blast = ctx.createBiquadFilter();
  blast.type = "lowpass";
  blast.frequency.setValueAtTime(2200, t);
  blast.frequency.exponentialRampToValueAtTime(320, t + 0.22);
  const blastGain = ctx.createGain();
  blastGain.gain.setValueAtTime(0.45, t);
  blastGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  noise.connect(blast).connect(blastGain).connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 0.24);
}

/**
 * A continuous engine voice for one tank. A pair of detuned sawtooths supply the
 * deep body, while looped noise run through a lowpass supplies the exhaust and
 * mechanical texture. An LFO pulsing at the firing rate chops both, so the
 * engine chugs like a diesel instead of droning like a synth; throttle (0..1)
 * drives volume, pitch and the pulse rate together.
 */
export class EngineSound {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly oscA: OscillatorNode;
  private readonly oscB: OscillatorNode;
  private readonly rumbleFilter: BiquadFilterNode;
  private readonly rumbleGain: GainNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly noiseFilter: BiquadFilterNode;
  private readonly pulseGain: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoDepth: GainNode;
  private running = false;

  constructor() {
    this.ctx = context();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Deep engine body: two slightly detuned sawtooths through a lowpass.
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = "lowpass";
    this.rumbleFilter.frequency.value = 160;
    this.rumbleFilter.Q.value = 0.7;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.5;
    this.oscA = ctx.createOscillator();
    this.oscA.type = "sawtooth";
    this.oscA.frequency.value = 34;
    this.oscB = ctx.createOscillator();
    this.oscB.type = "sawtooth";
    this.oscB.frequency.value = 35.3;
    this.oscA.connect(this.rumbleFilter);
    this.oscB.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain).connect(this.master);

    // Exhaust / mechanical noise, pulsed to mimic cylinder firing.
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer(ctx);
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "lowpass";
    this.noiseFilter.frequency.value = 500;
    this.noiseFilter.Q.value = 1.2;
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0.55;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.35;
    this.noise.connect(this.noiseFilter).connect(this.pulseGain).connect(noiseGain).connect(this.master);

    // Firing-rate pulse shared by the exhaust chug and the engine body.
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 8;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.4;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.pulseGain.gain);
    const rumbleDepth = ctx.createGain();
    rumbleDepth.gain.value = 0.25;
    this.lfo.connect(rumbleDepth);
    rumbleDepth.connect(this.rumbleGain.gain);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.oscA.start();
    this.oscB.start();
    this.noise.start();
    this.lfo.start();
  }

  /** throttle in 0..1; 0 silences the engine. */
  setThrottle(throttle: number) {
    const t = this.ctx.currentTime;
    const x = Math.max(0, Math.min(1, throttle));
    if (x <= 0.001) {
      this.master.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    this.master.gain.setTargetAtTime(0.04 + 0.07 * x, t, 0.08);
    const base = 34 + x * 66;
    this.oscA.frequency.setTargetAtTime(base, t, 0.06);
    this.oscB.frequency.setTargetAtTime(base * 1.008 + 1.5, t, 0.06);
    this.lfo.frequency.setTargetAtTime(7 + x * 18, t, 0.06);
    this.rumbleFilter.frequency.setTargetAtTime(140 + x * 240, t, 0.06);
    this.noiseFilter.frequency.setTargetAtTime(420 + x * 1500, t, 0.06);
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
      this.noise.stop(t + 0.3);
      this.lfo.stop(t + 0.3);
    } catch {
      /* already stopped */
    }
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.noise.disconnect();
    this.lfo.disconnect();
    this.rumbleFilter.disconnect();
    this.rumbleGain.disconnect();
    this.noiseFilter.disconnect();
    this.pulseGain.disconnect();
    this.lfoDepth.disconnect();
    this.master.disconnect();
  }
}
