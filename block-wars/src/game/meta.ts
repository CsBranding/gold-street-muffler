/**
 * Meta progression rules: upgrades, roster, Hood Base, ranks, offline income,
 * login streak, daily missions and chests. Pure functions over SaveData and
 * config, with no DOM, so they're unit-tested and safe to move server-side
 * for a future cloud save.
 */
import type { Character, GameConfig } from '../schema/types';
import type { SaveData } from '../services/save';
import type { BattleStats } from '../sim/battle';
import type { UpgradeLevels } from '../sim/loadout';

export type BuildingId = GameConfig['economy']['hoodBase'][number]['id'];

export interface Grant {
  cash: number;
  ice: number;
  rep: number;
  shards: Record<string, number>;
}
export const emptyGrant = (): Grant => ({ cash: 0, ice: 0, rep: 0, shards: {} });

export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (str: string) => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function applyGrant(save: SaveData, g: Grant): void {
  save.currencies.cash += g.cash;
  save.currencies.ice += g.ice;
  save.currencies.rep += g.rep;
  for (const [id, n] of Object.entries(g.shards)) save.shards[id] = (save.shards[id] ?? 0) + n;
}

// ------------------------------------------------------------- upgrades
export const growthCost = (base: number, growth: number, level: number) => Math.round(base * Math.pow(growth, level));

export function upgradeCost(cfg: GameConfig, id: string, save: SaveData): number | null {
  const def = cfg.economy.upgrades.find((u) => u.id === id)!;
  const lvl = save.upgrades[id] ?? 0;
  return lvl >= def.maxLevel ? null : growthCost(def.baseCost, def.costGrowth, lvl);
}

export function buyUpgrade(cfg: GameConfig, save: SaveData, id: string): boolean {
  const cost = upgradeCost(cfg, id, save);
  if (cost === null || save.currencies.cash < cost) return false;
  save.currencies.cash -= cost;
  save.upgrades[id] = (save.upgrades[id] ?? 0) + 1;
  return true;
}

// ------------------------------------------------------------- Hood Base
export function buildingCost(cfg: GameConfig, id: BuildingId, save: SaveData): number | null {
  const def = cfg.economy.hoodBase.find((b) => b.id === id)!;
  const lvl = save.base[id] ?? 0;
  return lvl >= def.maxLevel ? null : growthCost(def.baseCost, def.costGrowth, lvl);
}

export function buyBuilding(cfg: GameConfig, save: SaveData, id: BuildingId): boolean {
  const cost = buildingCost(cfg, id, save);
  if (cost === null || save.currencies.cash < cost) return false;
  save.currencies.cash -= cost;
  save.base[id] = (save.base[id] ?? 0) + 1;
  return true;
}

export function buildingValue(cfg: GameConfig, save: SaveData, id: BuildingId): number {
  const def = cfg.economy.hoodBase.find((b) => b.id === id)!;
  return (save.base[id] ?? 0) * def.perLevel;
}

// ---------------------------------------------------------------- roster
export function isUnlocked(save: SaveData, c: Character): boolean {
  return c.unlock.kind === 'default' || (save.leaderLevels[c.id] ?? 0) > 0;
}

export function leaderLevel(save: SaveData, c: Character): number {
  return save.leaderLevels[c.id] ?? (c.unlock.kind === 'default' ? 1 : 0);
}

/** Unlocking spends the shards; returns false when short. */
export function unlockLeader(save: SaveData, c: Character): boolean {
  if (isUnlocked(save, c) || c.unlock.kind !== 'shards') return false;
  const have = save.shards[c.id] ?? 0;
  if (have < c.unlock.shards) return false;
  save.shards[c.id] = have - c.unlock.shards;
  save.leaderLevels[c.id] = 1;
  return true;
}

export function levelUpCost(cfg: GameConfig, save: SaveData, c: Character): { shards: number; cash: number } | null {
  const r = cfg.economy.roster;
  const lvl = leaderLevel(save, c);
  if (lvl < 1 || lvl >= r.maxLeaderLevel) return null;
  const i = Math.min(lvl - 1, r.shardsPerLeaderLevel.length - 1);
  return { shards: r.shardsPerLeaderLevel[i], cash: r.cashPerLeaderLevel[Math.min(i, r.cashPerLeaderLevel.length - 1)] };
}

export function levelUpLeader(cfg: GameConfig, save: SaveData, c: Character): boolean {
  const cost = levelUpCost(cfg, save, c);
  if (!cost || (save.shards[c.id] ?? 0) < cost.shards || save.currencies.cash < cost.cash) return false;
  save.shards[c.id] -= cost.shards;
  save.currencies.cash -= cost.cash;
  save.leaderLevels[c.id] = leaderLevel(save, c) + 1;
  return true;
}

// ------------------------------------------------------------------ rank
/** Rep needed to reach rank r+1 from rank r (ranks start at 1). */
export const repForRank = (cfg: GameConfig, r: number) => Math.round(cfg.economy.rank.repBase * Math.pow(cfg.economy.rank.repGrowth, r - 1));

export function rankOf(cfg: GameConfig, rep: number): { rank: number; into: number; next: number } {
  let rank = 1;
  let left = rep;
  while (left >= repForRank(cfg, rank)) {
    left -= repForRank(cfg, rank);
    rank++;
  }
  return { rank, into: left, next: repForRank(cfg, rank) };
}

/** Pays out Ice for ranks reached since last time. Returns ranks gained. */
export function claimRanks(cfg: GameConfig, save: SaveData): number {
  const { rank } = rankOf(cfg, save.currencies.rep);
  const gained = Math.max(0, rank - save.rankClaimed);
  if (gained) {
    save.currencies.ice += gained * cfg.economy.rank.iceReward;
    save.rankClaimed = rank;
  }
  return gained;
}

// -------------------------------------------------------- offline income
export function offlineIncome(cfg: GameConfig, save: SaveData, now: number): { amount: number; hours: number } {
  const o = cfg.economy.offlineIncome;
  const mins = (now - save.lastSeen) / 60000;
  if (!save.lastSeen || mins < o.minMinutes) return { amount: 0, hours: 0 };
  const hours = Math.min(o.capHours, mins / 60);
  const offlineUp = cfg.economy.upgrades.find((u) => u.id === 'offline_income')!;
  const rate = (o.basePerHour + buildingValue(cfg, save, 'corner_store')) * (1 + (save.upgrades.offline_income ?? 0) * offlineUp.perLevel);
  return { amount: Math.floor(rate * hours), hours };
}

// ----------------------------------------------------------- login streak
/** Call on launch. Returns the streak reward if today hasn't been claimed. */
export function checkLogin(cfg: GameConfig, save: SaveData, now: number): { day: number; cash: number } | null {
  const today = dayKey(now);
  if (save.login.lastDay === today) return null;
  const yesterday = dayKey(now - 86400000);
  save.login.streak = save.login.lastDay === yesterday ? save.login.streak + 1 : 1;
  save.login.lastDay = today;
  const table = cfg.economy.daily.loginStreakCash;
  return { day: save.login.streak, cash: table[(save.login.streak - 1) % table.length] };
}

// ---------------------------------------------------------------- missions
export function ensureMissions(cfg: GameConfig, save: SaveData, now: number): void {
  const today = dayKey(now);
  if (save.missions.day === today && save.missions.list.length) return;
  const rand = seeded(hash(today));
  const pool = [...cfg.economy.missions];
  const list: SaveData['missions']['list'] = [];
  while (list.length < cfg.economy.daily.missionsPerDay && pool.length) {
    const m = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    // one mission per stat keeps the day varied
    if (list.some((x) => cfg.economy.missions.find((d) => d.id === x.id)!.stat === m.stat)) continue;
    list.push({ id: m.id, progress: 0, claimed: false });
  }
  save.missions = { day: today, list };
}

export interface RunReport {
  won: boolean;
  isBoss: boolean;
  stars: number;
  cash: number;
  stats: BattleStats;
  recruits: number;
}

/** Feed a finished run into today's missions. Returns ids that just completed. */
export function recordRun(cfg: GameConfig, save: SaveData, r: RunReport): string[] {
  const done: string[] = [];
  const add: Record<string, number> = {
    kills: r.stats.kills,
    gates: r.stats.gatesHit,
    levels: r.won ? 1 : 0,
    bosses: r.won && r.isBoss ? 1 : 0,
    recruits: r.recruits,
    cash: r.cash,
    obstacles: r.stats.obstaclesDestroyed,
    stars: r.stars,
  };
  for (const m of save.missions.list) {
    const def = cfg.economy.missions.find((d) => d.id === m.id);
    if (!def || m.claimed) continue;
    const before = m.progress;
    m.progress = Math.min(def.target, m.progress + add[def.stat]);
    if (before < def.target && m.progress >= def.target) done.push(m.id);
  }
  return done;
}

export function claimMission(cfg: GameConfig, save: SaveData, id: string): Grant | null {
  const m = save.missions.list.find((x) => x.id === id);
  const def = cfg.economy.missions.find((d) => d.id === id);
  if (!m || !def || m.claimed || m.progress < def.target) return null;
  m.claimed = true;
  const g = { ...emptyGrant(), cash: def.cash, ice: def.ice };
  applyGrant(save, g);
  return g;
}

// ------------------------------------------------------------------ chests
/** Shards go to the faction's locked/levelable leaders first. Deterministic for a seed. */
export function rollChest(cfg: GameConfig, save: SaveData, kind: 'chapter' | 'daily', seed: number): Grant {
  const spec = cfg.economy.chests[kind];
  const rand = seeded(seed);
  const faction = save.selection.factionId;
  const candidates = cfg.characters.characters.filter((c) => c.factionId === faction && c.unlock.kind === 'shards');
  const shards: Record<string, number> = {};
  const picks = [...candidates].sort(() => rand() - 0.5).slice(0, spec.leaders);
  picks.forEach((c, i) => {
    const n = Math.round(spec.shards / picks.length) + (i === 0 ? spec.shards % picks.length : 0);
    if (n > 0) shards[c.id] = n;
  });
  return { cash: Math.round(spec.cash * (0.8 + rand() * 0.4)), ice: spec.ice, rep: 0, shards };
}

/** Upgrade levels in the shape buildLoadout expects. */
export const upgradeLevels = (save: SaveData): UpgradeLevels => ({ ...save.upgrades });
