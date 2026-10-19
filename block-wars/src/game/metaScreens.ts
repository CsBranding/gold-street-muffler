/**
 * Phase 3 screens: Upgrades, Crew (roster), Hood Base, Daily (streak,
 * missions, free chest), plus chest-opening and reward popups. Rendered
 * into the shared screen element; the bottom nav is shared with the hub.
 */
import type { Character, GameConfig } from '../schema/types';
import type { AdService } from '../services/ads';
import type { SaveService } from '../services/save';
import { drawPortrait } from '../ui/portrait';
import * as meta from './meta';

export type MetaTab = 'play' | 'upgrades' | 'crew' | 'base' | 'daily';

export interface MetaHost {
  cfg: GameConfig;
  save: SaveService;
  ads: AdService;
  screenEl: HTMLElement;
  setScreen(html: string): void;
  refreshCurrencies(): void;
  showHub(): void;
  onLeaderChanged(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const fmt = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

const UPGRADE_FX: Record<string, (v: number) => string> = {
  starting_crew: (v) => `+${v} crew at start`,
  crew_damage: (v) => `+${Math.round(v * 100)}% crew damage`,
  fire_rate: (v) => `+${Math.round(v * 100)}% fire rate`,
  leader_hp: (v) => `+${v} leader HP`,
  loot_bonus: (v) => `+${Math.round(v * 100)}% loot`,
  offline_income: (v) => `+${Math.round(v * 100)}% offline cash`,
};

export class MetaScreens {
  constructor(private h: MetaHost) {}

  private get d() {
    return this.h.save.data;
  }

  // ------------------------------------------------------------- badges
  /** something to do on each tab (red dot in the nav) */
  badges(): Record<MetaTab, boolean> {
    const cfg = this.h.cfg;
    const d = this.d;
    const cheapUpgrade = cfg.economy.upgrades.some((u) => {
      const c = meta.upgradeCost(cfg, u.id, d);
      return c !== null && c <= d.currencies.cash;
    });
    const cheapBuilding = cfg.economy.hoodBase.some((b) => {
      const c = meta.buildingCost(cfg, b.id, d);
      return c !== null && c <= d.currencies.cash;
    });
    const crewReady = this.factionChars().some((c) => this.canUnlock(c) || this.canLevel(c));
    const daily =
      d.chests.length > 0 ||
      d.dailyChestDay !== meta.dayKey(Date.now()) ||
      d.missions.list.some((m) => !m.claimed && m.progress >= (cfg.economy.missions.find((x) => x.id === m.id)?.target ?? Infinity));
    return { play: false, upgrades: cheapUpgrade, crew: crewReady, base: cheapBuilding, daily };
  }

  nav(active: MetaTab): string {
    const b = this.badges();
    const tabs: [MetaTab, string][] = [
      ['upgrades', 'UPGRADE'],
      ['crew', 'CREW'],
      ['play', 'PLAY'],
      ['base', 'BASE'],
      ['daily', 'DAILY'],
    ];
    return `<nav class="tabs">${tabs.map(([t, label]) => `<button class="tab ${t === active ? 'on' : ''} ${t === 'play' ? 'tab-play' : ''}" data-tab="${t}">${label}${b[t] ? '<i class="dot"></i>' : ''}</button>`).join('')}</nav>`;
  }

  bindNav(): void {
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-tab]'))
      el.addEventListener('click', () => this.open(el.dataset.tab as MetaTab));
  }

  open(tab: MetaTab): void {
    if (tab === 'play') return this.h.showHub();
    if (tab === 'upgrades') return this.upgrades();
    if (tab === 'crew') return this.crew();
    if (tab === 'base') return this.base();
    return this.daily();
  }

  private page(tab: MetaTab, title: string, body: string): void {
    this.h.setScreen(`<div class="meta"><div class="meta-head"><h2>${esc(title)}</h2></div><div class="meta-body">${body}</div>${this.nav(tab)}</div>`);
    this.bindNav();
    this.h.refreshCurrencies();
  }

  private async commit(rerender: () => void): Promise<void> {
    await this.h.save.save();
    this.h.refreshCurrencies();
    rerender();
  }

  // ----------------------------------------------------------- upgrades
  upgrades(): void {
    const cfg = this.h.cfg;
    const rows = cfg.economy.upgrades
      .map((u) => {
        const lvl = this.d.upgrades[u.id] ?? 0;
        const cost = meta.upgradeCost(cfg, u.id, this.d);
        const fx = UPGRADE_FX[u.id] ?? ((v: number) => `+${v}`);
        return `<div class="row">
          <div class="row-main"><b>${esc(u.displayName)}</b><small>${fx(lvl * u.perLevel)}${cost !== null ? ` → ${fx((lvl + 1) * u.perLevel)}` : ''}</small>
          <div class="pips"><i style="width:${(lvl / u.maxLevel) * 100}%"></i></div></div>
          ${cost === null ? '<span class="maxed">MAX</span>' : `<button class="buy" data-up="${u.id}" ${cost > this.d.currencies.cash ? 'disabled' : ''}><i class="ico ico-cash"></i>${fmt(cost)}</button>`}
        </div>`;
      })
      .join('');
    this.page('upgrades', 'UPGRADES', rows);
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-up]'))
      el.addEventListener('click', () => meta.buyUpgrade(cfg, this.d, el.dataset.up!) && this.commit(() => this.upgrades()));
  }

  // --------------------------------------------------------------- crew
  private factionChars(): Character[] {
    return this.h.cfg.characters.characters.filter((c) => c.factionId === this.d.selection.factionId);
  }
  private canUnlock(c: Character): boolean {
    return !meta.isUnlocked(this.d, c) && c.unlock.kind === 'shards' && (this.d.shards[c.id] ?? 0) >= c.unlock.shards;
  }
  private canLevel(c: Character): boolean {
    const cost = meta.levelUpCost(this.h.cfg, this.d, c);
    return !!cost && (this.d.shards[c.id] ?? 0) >= cost.shards && this.d.currencies.cash >= cost.cash;
  }

  crew(): void {
    const cfg = this.h.cfg;
    const faction = cfg.factions.factions.find((f) => f.id === this.d.selection.factionId)!;
    const rows = this.factionChars()
      .map((c) => {
        const unlocked = meta.isUnlocked(this.d, c);
        const lvl = meta.leaderLevel(this.d, c);
        const shards = this.d.shards[c.id] ?? 0;
        const cost = meta.levelUpCost(cfg, this.d, c);
        const need = unlocked ? (cost?.shards ?? 0) : c.unlock.kind === 'shards' ? c.unlock.shards : 0;
        const active = c.id === this.d.selection.leaderId;
        let action = '';
        if (!unlocked) action = `<button class="buy" data-unlock="${c.id}" ${this.canUnlock(c) ? '' : 'disabled'}>UNLOCK</button>`;
        else if (cost) action = `<button class="buy" data-level="${c.id}" ${this.canLevel(c) ? '' : 'disabled'}><i class="ico ico-cash"></i>${fmt(cost.cash)}</button>`;
        else action = '<span class="maxed">MAX</span>';
        return `<div class="row crew-row ${active ? 'active' : ''} ${unlocked ? '' : 'locked'}">
          <canvas width="96" height="96" data-portrait="${c.id}"></canvas>
          <div class="row-main"><b>${esc(c.displayName)} ${unlocked ? `<em>LV ${lvl}</em>` : ''}</b><small>${esc(this.perkAt(c, Math.max(1, lvl)))}</small>
            <div class="pips shards"><i style="width:${need ? Math.min(100, (shards / need) * 100) : 100}%"></i><span>${shards}/${need || '—'} shards</span></div></div>
          <div class="row-act">${action}${unlocked && !active ? `<button class="mini" data-use="${c.id}">USE</button>` : active ? '<span class="tag-on">IN USE</span>' : ''}</div>
        </div>`;
      })
      .join('');
    this.page('crew', `${faction.displayName.toUpperCase()} CREW`, rows);
    for (const el of this.h.screenEl.querySelectorAll<HTMLCanvasElement>('[data-portrait]')) {
      const c = cfg.characters.characters.find((x) => x.id === el.dataset.portrait)!;
      drawPortrait(el, c, faction.colors.accent, c.id === this.d.selection.leaderId ? this.d.selection.custom : {});
    }
    const by = (id: string) => cfg.characters.characters.find((c) => c.id === id)!;
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-unlock]'))
      el.addEventListener('click', () => meta.unlockLeader(this.d, by(el.dataset.unlock!)) && this.commit(() => this.crew()));
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-level]'))
      el.addEventListener('click', () => meta.levelUpLeader(cfg, this.d, by(el.dataset.level!)) && this.commit(() => this.crew()));
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-use]'))
      el.addEventListener('click', () => {
        this.d.selection.leaderId = el.dataset.use!;
        this.d.selection.custom = {};
        this.h.onLeaderChanged();
        void this.commit(() => this.crew());
      });
  }

  perkAt(c: Character, lvl: number): string {
    const v = c.perk.value * (1 + (lvl - 1) * this.h.cfg.economy.roster.perkPerLevel);
    const p = c.perk.kind;
    if (p === 'fire_rate') return `+${Math.round(v * 100)}% fire rate`;
    if (p === 'starting_crew') return `+${Math.round(v)} starting crew`;
    if (p === 'barrel_loot') return `+${Math.round(v * 100)}% barrel loot`;
    return `Leader takes ${Math.round(Math.min(0.6, v) * 100)}% less damage`;
  }

  // --------------------------------------------------------------- base
  base(): void {
    const cfg = this.h.cfg;
    const fx = (id: meta.BuildingId, lvl: number): string => {
      const def = cfg.economy.hoodBase.find((b) => b.id === id)!;
      const v = lvl * def.perLevel;
      if (id === 'corner_store') return `$${Math.round(cfg.economy.offlineIncome.basePerHour + v)}/hr while away`;
      if (id === 'gym') return `+${Math.round(v * 100)}% crew toughness`;
      if (id === 'garage') return `+${Math.round(v * 100)}% ride time`;
      const w = cfg.weapons.weapons.find((x) => x.id === cfg.economy.armoryWeapons[Math.min(cfg.economy.armoryWeapons.length - 1, Math.round(v))])!;
      return `Start with ${w.displayName}`;
    };
    const cards = cfg.economy.hoodBase
      .map((b) => {
        const lvl = this.d.base[b.id] ?? 0;
        const cost = meta.buildingCost(cfg, b.id, this.d);
        return `<div class="bld bld-${b.id}">
          <div class="bld-art"><i></i></div>
          <div class="bld-main"><b>${esc(b.displayName)} <em>LV ${lvl}</em></b><small>${esc(b.blurb)}</small>
          <span class="fx">${fx(b.id, lvl)}${cost !== null ? ` → <b>${fx(b.id, lvl + 1)}</b>` : ''}</span></div>
          ${cost === null ? '<span class="maxed">MAX</span>' : `<button class="buy" data-bld="${b.id}" ${cost > this.d.currencies.cash ? 'disabled' : ''}><i class="ico ico-cash"></i>${fmt(cost)}</button>`}
        </div>`;
      })
      .join('');
    this.page('base', 'HOOD BASE', `<div class="blds">${cards}</div>`);
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-bld]'))
      el.addEventListener('click', () => meta.buyBuilding(cfg, this.d, el.dataset.bld as meta.BuildingId) && this.commit(() => this.base()));
  }

  // -------------------------------------------------------------- daily
  daily(): void {
    const cfg = this.h.cfg;
    meta.ensureMissions(cfg, this.d, Date.now());
    const table = cfg.economy.daily.loginStreakCash;
    const streak = this.d.login.streak;
    const days = table
      .map((c, i) => `<div class="day ${i < ((streak - 1) % table.length) + 1 ? 'got' : ''} ${i === (streak - 1) % table.length ? 'today' : ''}"><small>DAY ${i + 1}</small><b>$${fmt(c)}</b></div>`)
      .join('');
    const missions = this.d.missions.list
      .map((m) => {
        const def = cfg.economy.missions.find((x) => x.id === m.id);
        if (!def) return '';
        const done = m.progress >= def.target;
        return `<div class="row">
          <div class="row-main"><b>${esc(def.text.replace('{t}', fmt(def.target)))}</b>
          <div class="pips"><i style="width:${(m.progress / def.target) * 100}%"></i><span>${fmt(m.progress)}/${fmt(def.target)}</span></div></div>
          ${m.claimed ? '<span class="maxed">DONE</span>' : `<button class="buy" data-claim="${m.id}" ${done ? '' : 'disabled'}>$${fmt(def.cash)}${def.ice ? ` +${def.ice}<i class="ico ico-ice"></i>` : ''}</button>`}
        </div>`;
      })
      .join('');
    const freeReady = this.d.dailyChestDay !== meta.dayKey(Date.now());
    const pending = this.d.chests.length;
    this.page(
      'daily',
      'DAILY',
      `<h3>LOGIN STREAK · DAY ${streak}</h3><div class="streak">${days}</div>
       <h3>MISSIONS</h3>${missions}
       <h3>CHESTS</h3>
       <div class="row"><div class="row-main"><b>Free daily chest</b><small>Watch a short ad</small></div>
         <button class="buy ad" data-free ${freeReady ? '' : 'disabled'}><i class="play"></i>${freeReady ? 'OPEN' : 'TOMORROW'}</button></div>
       ${pending ? `<div class="row"><div class="row-main"><b>Chapter chests</b><small>${pending} waiting</small></div><button class="buy" data-open>OPEN</button></div>` : ''}`,
    );
    for (const el of this.h.screenEl.querySelectorAll<HTMLButtonElement>('[data-claim]'))
      el.addEventListener('click', () => meta.claimMission(cfg, this.d, el.dataset.claim!) && this.commit(() => this.daily()));
    this.h.screenEl.querySelector('[data-free]')?.addEventListener('click', async () => {
      if (!(await this.h.ads.showRewarded('daily_chest'))) return;
      this.d.dailyChestDay = meta.dayKey(Date.now());
      this.openChest('daily', Date.now() & 0x7fffffff, () => this.daily());
    });
    this.h.screenEl.querySelector('[data-open]')?.addEventListener('click', () => {
      const c = this.d.chests.shift()!;
      this.openChest(c.kind, c.seed, () => this.daily());
    });
  }

  // ------------------------------------------------------------ popups
  openChest(kind: 'chapter' | 'daily', seed: number, after: () => void): void {
    const g = meta.rollChest(this.h.cfg, this.d, kind, seed);
    meta.applyGrant(this.d, g);
    void this.h.save.save();
    const shardCards = Object.entries(g.shards)
      .map(([id, n]) => {
        const c = this.h.cfg.characters.characters.find((x) => x.id === id)!;
        return `<div class="loot"><canvas width="96" height="96" data-p="${id}"></canvas><b>x${n}</b><small>${esc(c.displayName)} shards</small></div>`;
      })
      .join('');
    this.modal(
      `<div class="chest ${kind}"><div class="chest-box"><i class="lid"></i></div></div>
       <h2>${kind === 'chapter' ? 'CHAPTER CHEST' : 'DAILY CHEST'}</h2>
       <div class="loots"><div class="loot"><i class="ico ico-cash big"></i><b>$${fmt(g.cash)}</b></div>${g.ice ? `<div class="loot"><i class="ico ico-ice big"></i><b>${g.ice}</b></div>` : ''}${shardCards}</div>`,
      'COLLECT',
      after,
    );
    const faction = this.h.cfg.factions.factions.find((f) => f.id === this.d.selection.factionId)!;
    for (const el of this.h.screenEl.querySelectorAll<HTMLCanvasElement>('[data-p]'))
      drawPortrait(el, this.h.cfg.characters.characters.find((c) => c.id === el.dataset.p)!, faction.colors.accent);
    this.h.refreshCurrencies();
  }

  modal(inner: string, button: string, after: () => void, extra?: { label: string; onClick: (close: () => void) => void }): void {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="card reward">${inner}<button class="btn" data-ok>${esc(button)}</button>${extra ? `<button class="btn btn-ad" data-extra><i class="play"></i>${esc(extra.label)}</button>` : ''}</div>`;
    this.h.screenEl.appendChild(el);
    const close = () => {
      el.remove();
      this.h.refreshCurrencies();
      after();
    };
    el.querySelector('[data-ok]')!.addEventListener('click', close);
    el.querySelector('[data-extra]')?.addEventListener('click', () => extra!.onClick(close));
  }
}
