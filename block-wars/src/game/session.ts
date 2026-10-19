/**
 * One level run: owns the Battle, drives the fixed-timestep loop, maps
 * pointer drag to steering, and forwards events to renderer + UI.
 */
import type { GameConfig, LevelDef, MapDef } from '../schema/types';
import { Battle, type SimEvent } from '../sim/battle';
import { botSteer } from '../sim/bot';
import type { Loadout } from '../sim/loadout';
import type { BattleRenderer } from '../render/BattleRenderer';
import type { Overlay } from '../ui/overlay';

export interface SessionHooks {
  onEvents(events: SimEvent[]): void;
  onWin(): void;
  onFail(): void;
}

export class GameSession {
  battle: Battle;
  paused = false;
  readonly autoplay: boolean;
  private acc = 0;
  private hitStop = 0;
  /** rolling ms per frame spent stepping the sim */
  simMs = 0;
  private endTimer = -1;
  private endKind: 'win' | 'fail' | null = null;
  private dragAnchor = 0;
  private dragStartPx = 0;
  private dragging = false;
  private keys = { left: false, right: false };
  private detach: () => void;

  constructor(
    private cfg: GameConfig,
    private renderer: BattleRenderer,
    private overlay: Overlay,
    private input: HTMLElement,
    map: MapDef,
    level: LevelDef,
    loadout: Loadout,
    private hooks: SessionHooks,
    opts: { autoplay?: boolean; seed?: number; skipSec?: number } = {},
  ) {
    this.autoplay = !!opts.autoplay;
    this.battle = new Battle(cfg, map, level, loadout, opts.seed ?? (Date.now() & 0x7fffffff));
    // dev/QA: fast-forward with the bot before the first frame
    while (opts.skipSec && this.battle.time < opts.skipSec && this.battle.status === 'running') {
      this.battle.setSteerTarget(botSteer(this.battle));
      this.battle.step();
      this.battle.drainEvents();
    }
    renderer.load(this.battle);
    this.detach = this.attachInput();
  }

  private attachInput(): () => void {
    const el = this.input;
    const down = (e: PointerEvent) => {
      if (this.autoplay || this.paused) return;
      // UI controls keep their clicks; capturing here would retarget them to the stage
      if ((e.target as HTMLElement).closest('button, .modal')) return;
      this.dragging = true;
      this.dragStartPx = e.clientX;
      this.dragAnchor = this.battle.crowd.targetX;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const w = el.clientWidth || 1;
      this.battle.setSteerTarget(this.dragAnchor + ((e.clientX - this.dragStartPx) / w) * this.cfg.game.input.dragMetersPerScreen);
    };
    const up = () => (this.dragging = false);
    const key = (e: KeyboardEvent, v: boolean) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') this.keys.left = v;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = v;
    };
    const kd = (e: KeyboardEvent) => key(e, true);
    const ku = (e: KeyboardEvent) => key(e, false);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }

  dispose(): void {
    this.detach();
  }

  revive(): void {
    this.battle.revive();
    this.endKind = null;
    this.endTimer = -1;
  }

  frame(realDt: number): void {
    const b = this.battle;
    const cfg = this.cfg;
    const dt = Math.min(realDt, 0.1);
    let scale = 1;
    const boss = b.level.boss;
    if (boss && boss.state === 'dead' && boss.deadT < cfg.game.boss.slowMoSec) scale = cfg.game.boss.slowMoScale;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      scale = Math.min(scale, cfg.game.feel.hitStopScale);
    }
    if (this.paused) scale = 0;

    if (scale > 0) {
      if (this.autoplay) b.setSteerTarget(botSteer(b));
      else if (this.keys.left || this.keys.right) {
        const dir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
        b.setSteerTarget(b.crowd.x + dir * 2.5);
      }
      this.acc += dt * scale;
      const t0 = performance.now();
      let steps = 0;
      while (this.acc >= b.dt && steps < cfg.game.sim.maxStepsPerFrame) {
        b.step();
        this.acc -= b.dt;
        steps++;
      }
      if (steps === cfg.game.sim.maxStepsPerFrame) this.acc = 0; // spiral-of-death guard
      this.simMs += (performance.now() - t0 - this.simMs) * 0.1;
      const events = b.drainEvents();
      if (events.length) {
        for (const e of events)
          if (e.t === 'explode' || (e.t === 'bossAttack' && (e.attackId === 'baton_slam' || e.attackId === 'taser_chain'))) this.hitStop = cfg.game.feel.hitStopSec;
        this.renderer.onEvents(b, events);
        this.hooks.onEvents(events);
      }
    }
    this.renderer.update(b, Math.min(1, this.acc / b.dt), dt * scale);
    this.overlay.updateBanner(dt);

    // end-of-level flow (real time, after slow-mo)
    if (!this.endKind && b.status !== 'running') {
      const slowDone = !boss || boss.state !== 'dead' || boss.deadT >= cfg.game.boss.slowMoSec;
      if (slowDone) {
        this.endKind = b.status === 'won' ? 'win' : 'fail';
        this.endTimer = b.status === 'won' ? cfg.game.flow.winDelaySec : cfg.game.flow.failDelaySec;
      }
    }
    if (this.endKind && this.endTimer >= 0 && !this.paused) {
      this.endTimer -= dt;
      if (this.endTimer < 0) {
        if (this.endKind === 'win') this.hooks.onWin();
        else this.hooks.onFail();
      }
    }
  }
}
