/**
 * Procedural audio (Web Audio). Every sound is synthesized at runtime, so
 * there are no audio files to license and nothing copied from other games.
 * Squad gunfire is voice-limited per second; the leader's shots always play.
 * Music is a step-sequenced beat whose intensity layer rises in fights.
 */
import type { GameConfig, Weapon } from '../schema/types';

type Cls = Weapon['class'];

interface ShotVoice {
  noiseHz: number;
  q: number;
  decay: number;
  thump: number;
  thumpHz: number;
  gain: number;
}

const SHOT: Record<Cls, ShotVoice> = {
  pistol: { noiseHz: 2200, q: 0.8, decay: 0.09, thump: 0.5, thumpHz: 140, gain: 0.55 },
  smg: { noiseHz: 2800, q: 1.1, decay: 0.06, thump: 0.3, thumpHz: 170, gain: 0.4 },
  rifle: { noiseHz: 1600, q: 0.7, decay: 0.12, thump: 0.7, thumpHz: 110, gain: 0.6 },
  shotgun: { noiseHz: 900, q: 0.5, decay: 0.28, thump: 1, thumpHz: 70, gain: 0.8 },
  lmg: { noiseHz: 1300, q: 0.6, decay: 0.14, thump: 0.8, thumpHz: 90, gain: 0.6 },
};

export class AudioService {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private shotBudget = 0;
  private lastTick = 0;
  private musicOn = false;
  private nextStep = 0;
  private step = 0;
  private intensity = 0;
  private timer: number | null = null;

  constructor(private cfg: GameConfig['game']['audio']) {}

  /** Browsers only allow audio after a user gesture; call from the first tap. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.cfg.master : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.cfg.sfx;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.cfg.music;
    this.music.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? this.cfg.master : 0, this.ctx.currentTime, 0.05);
  }

  private get ready(): boolean {
    return !!this.ctx && this.enabled && this.ctx.state === 'running';
  }

  private noiseBurst(t: number, dur: number, filter: BiquadFilterType, hz: number, q: number, gain: number, out: AudioNode = this.sfx, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(hz, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, hz: number, toHz: number, dur: number, gain: number, out: AudioNode = this.sfx): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (toHz !== hz) o.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ sfx
  shot(cls: Cls, leader: boolean): void {
    if (!this.ready) return;
    const now = this.ctx!.currentTime;
    // refill the squad voice budget continuously
    this.shotBudget = Math.min(this.cfg.maxShotVoicesPerSec, this.shotBudget + (now - this.lastTick) * this.cfg.maxShotVoicesPerSec);
    this.lastTick = now;
    if (!leader) {
      if (this.shotBudget < 1) return;
      this.shotBudget -= 1;
    }
    const v = SHOT[cls];
    const g = v.gain * (leader ? 1 : 0.45);
    const t = now + Math.random() * 0.01;
    this.noiseBurst(t, v.decay, 'bandpass', v.noiseHz * (0.9 + Math.random() * 0.2), v.q, g);
    this.tone(t, 'sine', v.thumpHz * 1.8, v.thumpHz, v.decay * 1.4, g * v.thump);
  }

  gate(positive: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const notes = positive ? [523, 659, 784, 1047] : [440, 349, 262];
    notes.forEach((n, i) => this.tone(t + i * 0.055, positive ? 'triangle' : 'square', n, n, 0.16, positive ? 0.22 : 0.12));
  }

  recruit(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 600, 1200, 0.08, 0.12);
  }

  kill(): void {
    if (!this.ready || Math.random() > 0.35) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.12, 'lowpass', 900, 0.7, 0.18);
  }

  hit(blocked: boolean): void {
    if (!this.ready || Math.random() > 0.15) return;
    const t = this.ctx!.currentTime;
    if (blocked) this.tone(t, 'square', 1800, 1400, 0.05, 0.06);
    else this.noiseBurst(t, 0.04, 'highpass', 3500, 0.7, 0.06);
  }

  woodBreak(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.035, 0.12, 'bandpass', 500 + Math.random() * 900, 2, 0.35);
    this.tone(t, 'sine', 160, 60, 0.22, 0.5);
  }

  explosion(big = false): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, big ? 1.4 : 0.9, 'lowpass', 2400, 0.5, big ? 1 : 0.8, this.sfx, 120);
    this.tone(t, 'sine', 120, 30, big ? 1.1 : 0.7, 0.9);
  }

  slam(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 90, 28, 0.9, 1);
    this.noiseBurst(t, 0.5, 'lowpass', 900, 0.6, 0.7, this.sfx, 80);
  }

  zap(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 6; i++) this.tone(t + i * 0.04, 'sawtooth', 1200 + Math.random() * 1600, 300, 0.06, 0.12);
  }

  siren(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    for (let i = 0; i < 4; i++) {
      o.frequency.setValueAtTime(i % 2 ? 960 : 720, t + i * 0.3);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.05);
    g.gain.setValueAtTime(0.14, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 1.3);
  }

  horn(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (const [i, hz] of [[0, 392], [0.28, 392]] as const) {
      this.tone(t + i, 'sawtooth', hz, hz, 0.22, 0.18);
      this.tone(t + i, 'sawtooth', hz * 1.26, hz * 1.26, 0.22, 0.12);
    }
  }

  chopper(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 14; i++) this.noiseBurst(t + i * 0.11, 0.07, 'lowpass', 300, 0.8, 0.35 * (1 - i / 16));
  }

  reward(rarity: string): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const n = rarity === 'legendary' ? 6 : rarity === 'epic' ? 5 : 4;
    for (let i = 0; i < n; i++) this.tone(t + i * 0.05, 'triangle', 880 * Math.pow(1.19, i), 880 * Math.pow(1.19, i), 0.14, 0.16);
  }

  whoosh(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.35, 'bandpass', 400, 1.2, 0.25, this.sfx, 3000);
  }

  win(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1047, 1319].forEach((n, i) => this.tone(t + i * 0.09, 'triangle', n, n, 0.5, 0.2));
  }

  fail(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [392, 330, 262, 196].forEach((n, i) => this.tone(t + i * 0.16, 'sawtooth', n, n * 0.98, 0.3, 0.12));
  }

  // ---------------------------------------------------------------- music
  /** intensity 0 = cruising, 1 = fight / boss */
  setIntensity(v: number): void {
    this.intensity = v;
  }

  startMusic(): void {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.step = 0;
    const tick = () => {
      if (!this.musicOn || !this.ctx) return;
      const stepDur = 60 / this.cfg.bpm / 4;
      while (this.nextStep < this.ctx.currentTime + 0.12) {
        if (this.enabled && this.ctx.state === 'running') this.playStep(this.step % 32, this.nextStep);
        this.nextStep += stepDur;
        this.step++;
      }
      this.timer = window.setTimeout(tick, 25);
    };
    tick();
  }

  stopMusic(): void {
    this.musicOn = false;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  private playStep(s: number, t: number): void {
    const m = this.music;
    const ctx = this.ctx!;
    const hard = this.intensity > 0.5;
    // kick: boom-bap pattern
    if ([0, 7, 10, 16, 23, 26].includes(s)) this.tone(t, 'sine', 140, 45, 0.28, 0.9, m);
    // snare on 2 and 4
    if (s % 8 === 4) {
      this.noiseBurst(t, 0.16, 'bandpass', 1800, 0.8, 0.45, m);
      this.tone(t, 'triangle', 220, 180, 0.08, 0.2, m);
    }
    // hats: 8ths, 16ths when the fight is on
    if (s % 2 === 0 || hard) this.noiseBurst(t, 0.03, 'highpass', 8000, 0.7, s % 4 === 2 ? 0.14 : 0.08, m);
    // bass line (minor, two bars)
    const bass = [55, 0, 0, 55, 0, 0, 65.4, 0, 49, 0, 0, 49, 0, 0, 58.3, 0];
    const b = bass[s % 16];
    if (b) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = b;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = hard ? 520 : 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(f).connect(g).connect(m);
      o.start(t);
      o.stop(t + 0.32);
    }
    // stab chord on the fight layer
    if (hard && s % 16 === 0) for (const n of [220, 261.6, 329.6]) this.tone(t, 'square', n, n, 0.18, 0.05, m);
  }
}
