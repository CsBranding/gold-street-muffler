/**
 * Screen flow + top-level loop. Phase 1 flow: Splash → Hub (map/level select)
 * → Play → Results → Hub. Faction/character/mode select arrive in Phase 2
 * and plug into `save.data.selection`.
 */
import type { GameConfig, LevelDef, MapDef } from '../schema/types';
import { BattleRenderer, rewardText } from '../render/BattleRenderer';
import { MockAdService, type AdService } from '../services/ads';
import { AudioService } from '../services/audio';
import { Haptics } from '../services/haptics';
import { SaveService } from '../services/save';
import type { SimEvent } from '../sim/battle';
import { buildLoadout } from '../sim/loadout';
import { Overlay } from '../ui/overlay';
import { drawPortrait } from '../ui/portrait';
import { computeResult, type LevelResult } from './results';
import { GameSession } from './session';

type Screen = 'splash' | 'hub' | 'play' | 'results';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class App {
  private stage: HTMLDivElement;
  private screenEl: HTMLDivElement;
  private hud: HTMLDivElement;
  private overlay: Overlay;
  private renderer: BattleRenderer;
  private save: SaveService;
  private ads: AdService;
  private haptics = new Haptics();
  private audio: AudioService;
  private session: GameSession | null = null;
  private screen: Screen = 'splash';
  private last = performance.now();
  private result: LevelResult | null = null;
  private current: { map: MapDef; level: LevelDef } | null = null;
  private fps = { frames: 0, t: 0, value: 60, el: null as HTMLDivElement | null };
  /** adaptive quality: smoothed frame ms + how long it has been over budget */
  private perf = { ema: 16, over: 0, forced: false };

  constructor(root: HTMLElement, private cfg: GameConfig) {
    root.innerHTML = '';
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    root.appendChild(this.stage);
    this.overlay = new Overlay(this.stage, cfg.game.render.maxDamageNumbers, cfg.game.render.damageNumberLife);
    this.renderer = new BattleRenderer(this.stage, cfg, this.overlay, { onKillHaptic: () => this.haptics.tick() });
    this.stage.insertBefore(this.renderer.renderer.domElement, this.stage.firstChild);
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.stage.appendChild(this.hud);
    this.screenEl = document.createElement('div');
    this.screenEl.className = 'screen';
    this.stage.appendChild(this.screenEl);
    this.save = new SaveService(cfg);
    this.audio = new AudioService(cfg.game.audio);
    // audio can only start from a user gesture
    this.stage.addEventListener('pointerdown', () => {
      this.audio.unlock();
      this.audio.startMusic();
    });
    this.ads = new MockAdService(cfg.economy.ads, this.stage);
    if (new URLSearchParams(location.search).has('fps')) {
      this.fps.el = document.createElement('div');
      this.fps.el.className = 'fps';
      this.stage.appendChild(this.fps.el);
    }
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  async start(): Promise<void> {
    await this.save.load();
    this.haptics.enabled = this.save.data.settings.haptics;
    this.audio.setEnabled(this.save.data.settings.sound);
    const q = new URLSearchParams(location.search).get('q');
    this.perf.forced = q !== null;
    this.renderer.setQuality(q !== null ? Number(q) : (this.save.data.settings.quality ?? 3));
    this.buildHud();
    const params = new URLSearchParams(location.search);
    const direct = params.get('level');
    if (params.has('stress')) this.stress();
    else if (direct) {
      const map = this.cfg.levels.maps.find((m) => m.id === (params.get('map') ?? this.save.data.selection.mapId))!;
      const level = map.levels.find((l) => l.number === Number(direct));
      if (level) this.play(map, level, params.has('auto'), Number(params.get('skip') ?? 0), params.has('seed') ? Number(params.get('seed')) : undefined);
    } else this.showSplash();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Portrait 9:16 stage, letterboxed on desktop, full-bleed on phones. */
  private layout(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let w = W;
    let h = H;
    if (W / H > 9 / 16) w = Math.round(H * (9 / 16));
    else if (W / H < 9 / 19.5) h = Math.round(W * (19.5 / 9));
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;
    this.renderer.resize(w, h);
  }

  private loop(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.session) this.session.frame(dt);
    const b = this.session?.battle;
    this.audio.setIntensity(b && (b.phase === 'hold' || b.phase === 'push' || b.phase === 'boss') ? 1 : 0);
    if (this.screen === 'play') {
      this.updateHud();
      this.adaptQuality(dt);
    }
    if (this.fps.el) {
      this.fps.frames++;
      this.fps.t += dt;
      if (this.fps.t >= 0.5) {
        this.fps.value = Math.round(this.fps.frames / this.fps.t);
        this.fps.frames = 0;
        this.fps.t = 0;
        const b = this.session?.battle;
        const st = this.renderer.stats;
        this.fps.el.textContent = `${this.fps.value} fps · q${this.renderer.quality} · crew ${b?.crewCount ?? 0} · enemies ${b ? b.level.hordes.reduce((s, h) => s + Math.max(0, h.alive), 0) : 0} · sim ${(this.session?.simMs ?? 0).toFixed(1)}ms · scene ${st.updateMs.toFixed(1)}ms · gl ${st.renderMs.toFixed(1)}ms`;
      }
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  /** Step quality down when frames stay slow; remembered per device in the save. */
  private adaptQuality(dt: number): void {
    const r = this.cfg.game.render;
    this.perf.ema += (dt * 1000 - this.perf.ema) * 0.05;
    if (this.perf.forced || this.renderer.quality === 0) return;
    this.perf.over = this.perf.ema > r.adaptiveFrameMs ? this.perf.over + dt : 0;
    if (this.perf.over > r.adaptiveWindowSec) {
      this.perf.over = 0;
      this.perf.ema = 16;
      this.renderer.setQuality(this.renderer.quality - 1);
      this.save.data.settings.quality = this.renderer.quality;
      void this.save.save();
    }
  }

  // ------------------------------------------------------------------ HUD
  private faction() {
    return this.cfg.factions.factions.find((f) => f.id === this.save.data.selection.factionId)!;
  }
  private leaderChar() {
    return this.cfg.characters.characters.find((c) => c.id === this.save.data.selection.leaderId)!;
  }

  private buildHud(): void {
    const cur = this.cfg.economy.currencies;
    this.hud.innerHTML = `
      <div class="hud-left">
        <canvas class="portrait" width="112" height="112"></canvas>
        <div class="pills">
          ${cur.map((c) => `<div class="pill" data-cur="${c.id}" style="--pill:${c.color}"><i class="ico ico-${c.id}"></i><span>0</span></div>`).join('')}
        </div>
      </div>
      <div class="hud-right">
        <div class="hud-btns">
          <button class="btn-sound" aria-label="Sound"></button>
          <button class="btn-pause" aria-label="Pause">II</button>
        </div>
        <div class="weapon-chip"><span class="wname"></span><span class="wlvl"></span></div>
      </div>`;
    drawPortrait(this.hud.querySelector('canvas')!, this.leaderChar(), this.faction().colors.accent);
    this.hud.querySelector('.btn-pause')!.addEventListener('click', () => this.pause());
    const snd = this.hud.querySelector<HTMLButtonElement>('.btn-sound')!;
    const paint = () => snd.classList.toggle('off', !this.save.data.settings.sound);
    paint();
    snd.addEventListener('click', () => {
      this.save.data.settings.sound = !this.save.data.settings.sound;
      this.audio.setEnabled(this.save.data.settings.sound);
      paint();
      void this.save.save();
    });
    this.refreshCurrencies();
  }

  private refreshCurrencies(): void {
    const c = this.save.data.currencies;
    for (const el of this.hud.querySelectorAll<HTMLDivElement>('.pill')) {
      const v = c[el.dataset.cur as keyof typeof c];
      el.querySelector('span')!.textContent = formatNum(v);
    }
  }

  private lastWeapon = '';
  private updateHud(): void {
    const b = this.session?.battle;
    if (!b) return;
    const key = `${b.squad.weapon.id}:${b.squad.level}:${b.buffs.lowrider > 0}:${b.buffs.dirtBike > 0}`;
    if (key !== this.lastWeapon) {
      this.lastWeapon = key;
      const veh = b.buffs.lowrider > 0 ? ' · LOWRIDER' : b.buffs.dirtBike > 0 ? ' · DIRT BIKE' : '';
      this.hud.querySelector('.wname')!.textContent = b.squad.weapon.displayName.toUpperCase() + veh;
      this.hud.querySelector('.wlvl')!.textContent = `LV${b.squad.level}`;
      const chip = this.hud.querySelector<HTMLDivElement>('.weapon-chip')!;
      chip.style.setProperty('--rar', this.cfg.game.rarityColors[b.squad.weapon.rarity]);
    }
  }

  // -------------------------------------------------------------- screens
  private setScreen(s: Screen, html: string): void {
    this.screen = s;
    this.stage.dataset.screen = s;
    this.screenEl.innerHTML = html;
  }

  private startAttract(): void {
    this.session?.dispose();
    const map = this.cfg.levels.maps[0];
    const level = map.levels[0];
    const loadout = buildLoadout(this.cfg, this.leaderChar(), 'vs_cops');
    this.session = new GameSession(this.cfg, this.renderer, this.overlay, this.stage, map, level, loadout, {
      onEvents: () => {},
      onWin: () => this.startAttract(),
      onFail: () => this.startAttract(),
    }, { autoplay: true, seed: 11 });
  }

  private showSplash(): void {
    this.startAttract();
    const f = this.faction();
    this.setScreen('splash', `
      <div class="splash">
        <h1 class="title">${esc(this.cfg.game.title)}</h1>
        <p class="slogan">${esc(f.slogan)}</p>
        <button class="btn btn-big" data-act="play">TAP TO PLAY</button>
        <small class="legal">Stylized violence · 17+</small>
      </div>`);
    this.screenEl.querySelector('[data-act="play"]')!.addEventListener('click', () => this.showHub());
  }

  private showHub(): void {
    if (!this.session?.autoplay) this.startAttract();
    const sel = this.save.data.selection;
    const maps = [...this.cfg.levels.maps].sort((a, b) => a.unlockOrder - b.unlockOrder);
    const map = maps.find((m) => m.id === sel.mapId) ?? maps[0];
    const cleared = this.save.data.progress[map.id] ?? 0;
    const authored = new Map(map.levels.map((l) => [l.number, l]));
    const next = map.levels.find((l) => l.number > cleared);
    const nodes: string[] = [];
    for (let n = 10; n >= 1; n--) {
      const l = authored.get(n);
      const done = n <= cleared && !!l;
      const open = !!l && (done || l === next);
      const cls = [done ? 'done' : '', open && !done ? 'next' : '', !l ? 'soon' : '', !open ? 'locked' : '', l?.isBoss ? 'boss' : ''].join(' ');
      nodes.push(`<button class="node ${cls}" ${open ? `data-level="${n}"` : 'disabled'}>
          <b>${l?.isBoss ? 'BOSS' : n}</b><small>${l ? esc(l.name) : 'Coming soon'}</small></button>`);
    }
    const f = this.faction();
    this.setScreen('hub', `
      <div class="hub">
        <div class="hub-head">
          <div class="tag" style="--c:${f.colors.primary}">${esc(f.displayName.toUpperCase())} · VS ${esc(this.cfg.factions.police.displayName.toUpperCase())}</div>
          <h2>${esc(map.displayName.toUpperCase())}</h2>
        </div>
        <div class="path">${nodes.join('')}</div>
        <div class="maps">
          ${maps.map((m) => `<div class="mapcard ${m.id === map.id ? 'on' : 'locked'}" style="--sky:${m.theme.sky};--road:${m.theme.road}">${esc(m.displayName)}</div>`).join('')}
        </div>
      </div>`);
    for (const el of this.screenEl.querySelectorAll<HTMLButtonElement>('[data-level]'))
      el.addEventListener('click', () => this.play(map, authored.get(Number(el.dataset.level))!));
    this.refreshCurrencies();
  }

  private play(map: MapDef, level: LevelDef, autoplay = false, skipSec = 0, seed?: number): void {
    this.session?.dispose();
    this.current = { map, level };
    const sel = this.save.data.selection;
    const loadout = buildLoadout(this.cfg, this.leaderChar(), sel.mode, this.save.data.upgrades);
    this.setScreen('play', '');
    this.lastWeapon = '';
    this.session = new GameSession(this.cfg, this.renderer, this.overlay, this.stage, map, level, loadout, {
      onEvents: (ev) => this.onEvents(ev),
      onWin: () => this.finish(),
      onFail: () => this.showFail(),
    }, { autoplay, skipSec, seed });
  }

  /** Perf scene from the acceptance criteria: 500 crew vs 1,500 enemies. Dev only (?stress&fps). */
  private stress(): void {
    const map = this.cfg.levels.maps[0];
    const level: LevelDef = {
      ...map.levels[0],
      segments: [
        { kind: 'gap', length: 6 },
        { kind: 'horde', length: 80, side: 'enemy', columns: 14, enemies: [{ enemyId: 'riot_cop', count: 300 }, { enemyId: 'patrol_officer', count: 1200 }], pickups: [], x: 0, offset: 0 },
      ],
    };
    this.play(map, level, true);
    this.session!.battle.crowd.followers = 499;
  }

  private onEvents(events: SimEvent[]): void {
    const text = this.cfg.game.banners.text;
    const a = this.audio;
    for (const e of events) {
      switch (e.t) {
        case 'shot': a.shot(e.cls, e.leader); break;
        case 'hit': a.hit(e.blocked); break;
        case 'kill': a.kill(); break;
        case 'gate': a.gate(!e.negative); break;
        case 'recruits': a.recruit(); break;
        case 'obstacleDestroyed': a.woodBreak(); break;
        case 'explode': a.explosion(); break;
        case 'reward': a.reward(e.rarity); break;
        case 'banner': a.whoosh(); break;
        case 'bossAttack':
          if (e.attackId === 'baton_slam') a.slam();
          if (e.attackId === 'taser_chain') a.zap();
          break;
        case 'telegraph':
          if (e.attackId === 'call_backup' || e.attackId === 'summon_runners') a.siren();
          break;
        case 'bossEnrage': a.siren(); break;
        case 'bossDefeated': a.explosion(true); break;
        case 'won': a.win(); break;
        case 'failed': a.fail(); break;
        default: break;
      }
      if (e.t === 'banner') this.overlay.banner(text[e.key], this.cfg.game.banners.durationSec, e.key);
      if (e.t === 'reward' && e.reward.kind === 'weapon') this.overlay.banner(rewardText(this.cfg, e.reward), 1.2, 'reward');
      if (e.t === 'bossDefeated' || e.t === 'explode') this.haptics.heavy();
    }
  }

  private pause(): void {
    if (!this.session || this.screen !== 'play' || this.session.paused) return;
    this.session.paused = true;
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="card"><h2>PAUSED</h2>
      <button class="btn" data-act="resume">RESUME</button>
      <button class="btn btn-ghost" data-act="quit">QUIT LEVEL</button></div>`;
    this.screenEl.appendChild(el);
    el.querySelector('[data-act="resume"]')!.addEventListener('click', () => {
      el.remove();
      this.session!.paused = false;
    });
    el.querySelector('[data-act="quit"]')!.addEventListener('click', () => {
      el.remove();
      this.showHub();
    });
  }

  private showFail(): void {
    const b = this.session!.battle;
    const canRevive = b.stats.revives < this.cfg.economy.ads.maxRevivesPerLevel;
    this.session!.paused = true;
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="card fail"><h2>${esc(this.cfg.game.banners.text.fail)}</h2>
      ${canRevive ? `<button class="btn btn-ad" data-act="revive"><i class="play"></i>REVIVE +${this.cfg.economy.ads.reviveCrew} CREW</button>` : ''}
      <button class="btn btn-ghost" data-act="give">GIVE UP</button></div>`;
    this.screenEl.appendChild(el);
    el.querySelector('[data-act="revive"]')?.addEventListener('click', async () => {
      if (await this.ads.showRewarded('revive')) {
        el.remove();
        this.session!.revive();
        this.session!.paused = false;
      }
    });
    el.querySelector('[data-act="give"]')!.addEventListener('click', () => {
      el.remove();
      this.finish();
    });
  }

  private finish(): void {
    const s = this.session!;
    const { map, level } = this.current!;
    const prev = this.save.data.progress[map.id] ?? 0;
    const r = computeResult(this.cfg, s.battle, prev);
    this.result = r;
    s.paused = true;
    const shardHtml = Object.entries(r.shards)
      .map(([id, n]) => `<div class="rw"><i class="ico ico-shard"></i>${esc(this.cfg.characters.characters.find((c) => c.id === id)?.displayName ?? id)} shard x${n}</div>`)
      .join('');
    const stars = [0, 1, 2].map((i) => `<i class="star ${i < r.stars ? 'on' : ''}"></i>`).join('');
    this.setScreen('results', `
      <div class="results ${r.won ? 'win' : 'lose'}">
        <h2>${esc(r.won ? this.cfg.game.banners.text.clear : this.cfg.game.banners.text.fail)}</h2>
        <div class="stars">${stars}</div>
        <div class="stats">
          <div><b>${r.kills}</b><small>KNOCKED DOWN</small></div>
          <div><b>${r.survivors}</b><small>CREW LEFT</small></div>
          <div><b>${r.peakCrew}</b><small>PEAK CREW</small></div>
          <div><b>${r.timeSec.toFixed(0)}s</b><small>TIME</small></div>
        </div>
        <div class="rewards">
          <div class="rw"><i class="ico ico-cash"></i><span data-cash>${formatNum(r.cash)}</span></div>
          ${r.rep ? `<div class="rw"><i class="ico ico-rep"></i>${formatNum(r.rep)}</div>` : ''}
          ${r.ice ? `<div class="rw"><i class="ico ico-ice"></i>${r.ice}</div>` : ''}
          ${shardHtml}
        </div>
        ${r.won && r.cash > 0 ? `<button class="btn btn-ad" data-act="double"><i class="play"></i>2X LOOT</button>` : ''}
        <button class="btn btn-big" data-act="continue">CONTINUE</button>
      </div>`);
    this.screenEl.querySelector('[data-act="double"]')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      if (await this.ads.showRewarded('double_loot')) {
        r.cash *= 2;
        this.screenEl.querySelector('[data-cash]')!.textContent = formatNum(r.cash);
        btn.remove();
      } else btn.disabled = false;
    });
    this.screenEl.querySelector('[data-act="continue"]')!.addEventListener('click', () => this.collect(level.number, map.id));
  }

  private async collect(levelNumber: number, mapId: string): Promise<void> {
    const r = this.result!;
    const d = this.save.data;
    d.currencies.cash += r.cash;
    d.currencies.rep += r.rep;
    d.currencies.ice += r.ice;
    for (const [id, n] of Object.entries(r.shards)) d.shards[id] = (d.shards[id] ?? 0) + n;
    if (r.won) d.progress[mapId] = Math.max(d.progress[mapId] ?? 0, levelNumber);
    d.levelsPlayed++;
    await this.save.save();
    this.refreshCurrencies();
    if (this.ads.shouldShowInterstitial(d.levelsPlayed)) await this.ads.showInterstitial();
    this.showHub();
  }
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
