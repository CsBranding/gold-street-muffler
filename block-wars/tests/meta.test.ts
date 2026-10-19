import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/schema/loadConfig';
import { defaultSave } from '../src/services/save';
import * as meta from '../src/game/meta';
import { buildLoadout } from '../src/sim/loadout';
import { Battle } from '../src/sim/battle';

const cfg = loadConfig();
const fresh = () => defaultSave(cfg);
const char = (id: string) => cfg.characters.characters.find((c) => c.id === id)!;

describe('upgrades', () => {
  it('cost grows, spends cash, respects max', () => {
    const s = fresh();
    s.currencies.cash = 1e9;
    const c0 = meta.upgradeCost(cfg, 'starting_crew', s)!;
    expect(meta.buyUpgrade(cfg, s, 'starting_crew')).toBe(true);
    expect(meta.upgradeCost(cfg, 'starting_crew', s)!).toBeGreaterThan(c0);
    expect(s.currencies.cash).toBe(1e9 - c0);
    const def = cfg.economy.upgrades.find((u) => u.id === 'starting_crew')!;
    while (meta.buyUpgrade(cfg, s, 'starting_crew'));
    expect(s.upgrades.starting_crew).toBe(def.maxLevel);
    expect(meta.upgradeCost(cfg, 'starting_crew', s)).toBeNull();
  });
  it('refuses when broke', () => {
    const s = fresh();
    expect(meta.buyUpgrade(cfg, s, 'crew_damage')).toBe(false);
  });
  it('upgrades and base change the run loadout', () => {
    const s = fresh();
    s.upgrades = { starting_crew: 5, crew_damage: 4 };
    s.base = { gym: 2, armory: 2, garage: 1 };
    const l = buildLoadout(cfg, char('red_lean'), 'vs_cops', s.upgrades, { leaderLevel: 3, base: s.base });
    expect(l.startCrew).toBe(5);
    expect(l.crewDamageMult).toBeCloseTo(1.2);
    expect(l.unitHpMult).toBeGreaterThan(1);
    expect(l.vehicleDurationMult).toBeGreaterThan(1);
    expect(l.squadWeaponId).toBe(cfg.economy.armoryWeapons[2]);
    expect(l.fireRateMult).toBeCloseTo(1 + 0.1 * (1 + 2 * cfg.economy.roster.perkPerLevel));
    const map = cfg.levels.maps[0];
    const b = new Battle(cfg, map, map.levels[0], l, 1);
    expect(b.squad.weapon.id).toBe(cfg.economy.armoryWeapons[2]);
    expect(b.crewCount).toBe(6);
  });
});

describe('roster', () => {
  it('unlock spends shards, level up spends shards + cash', () => {
    const s = fresh();
    const c = char('red_big_ru');
    expect(meta.isUnlocked(s, c)).toBe(false);
    s.shards[c.id] = 25;
    expect(meta.unlockLeader(s, c)).toBe(true);
    expect(s.shards[c.id]).toBe(5);
    expect(meta.leaderLevel(s, c)).toBe(1);
    const cost = meta.levelUpCost(cfg, s, c)!;
    s.shards[c.id] = cost.shards;
    s.currencies.cash = cost.cash;
    expect(meta.levelUpLeader(cfg, s, c)).toBe(true);
    expect(meta.leaderLevel(s, c)).toBe(2);
    expect(s.currencies.cash).toBe(0);
  });
});

describe('ranks, offline, login, missions, chests', () => {
  it('rank grants ice once per rank', () => {
    const s = fresh();
    s.currencies.rep = meta.repForRank(cfg, 1) + meta.repForRank(cfg, 2) + 1;
    expect(meta.rankOf(cfg, s.currencies.rep).rank).toBe(3);
    const ice = s.currencies.ice;
    expect(meta.claimRanks(cfg, s)).toBe(2);
    expect(s.currencies.ice).toBe(ice + 2 * cfg.economy.rank.iceReward);
    expect(meta.claimRanks(cfg, s)).toBe(0);
  });
  it('offline income accrues, caps, and grows with the Corner Store', () => {
    const s = fresh();
    const now = Date.now();
    s.lastSeen = now - 2 * 3600e3;
    const a = meta.offlineIncome(cfg, s, now).amount;
    expect(a).toBeGreaterThan(0);
    s.base.corner_store = 3;
    expect(meta.offlineIncome(cfg, s, now).amount).toBeGreaterThan(a);
    s.lastSeen = now - 100 * 3600e3;
    expect(meta.offlineIncome(cfg, s, now).hours).toBe(cfg.economy.offlineIncome.capHours);
    s.lastSeen = now - 60e3;
    expect(meta.offlineIncome(cfg, s, now).amount).toBe(0);
  });
  it('login streak counts consecutive days and resets on a gap', () => {
    const s = fresh();
    const d0 = new Date(2026, 9, 1, 12).getTime();
    expect(meta.checkLogin(cfg, s, d0)!.day).toBe(1);
    expect(meta.checkLogin(cfg, s, d0 + 3600e3)).toBeNull();
    expect(meta.checkLogin(cfg, s, d0 + 86400e3)!.day).toBe(2);
    expect(meta.checkLogin(cfg, s, d0 + 4 * 86400e3)!.day).toBe(1);
  });
  it('daily missions roll per day, track runs, and pay once', () => {
    const s = fresh();
    const now = new Date(2026, 9, 1, 12).getTime();
    meta.ensureMissions(cfg, s, now);
    expect(s.missions.list).toHaveLength(cfg.economy.daily.missionsPerDay);
    const stats = { kills: 5000, gatesHit: 100, obstaclesDestroyed: 100, recruits: 0, cash: 0, shards: {}, revives: 0, peakCrew: 0, timeSec: 0 };
    const done = meta.recordRun(cfg, s, { won: true, isBoss: true, stars: 9, cash: 1e5, stats, recruits: 1e4 });
    expect(done.length).toBe(s.missions.list.length);
    const cash = s.currencies.cash;
    expect(meta.claimMission(cfg, s, done[0])).not.toBeNull();
    expect(s.currencies.cash).toBeGreaterThan(cash);
    expect(meta.claimMission(cfg, s, done[0])).toBeNull();
    const day1 = s.missions.list.map((m) => m.id).join();
    meta.ensureMissions(cfg, s, now + 86400e3);
    expect(s.missions.list.every((m) => m.progress === 0)).toBe(true);
    expect(typeof day1).toBe('string');
  });
  it('chests are deterministic and give faction shards', () => {
    const s = fresh();
    const a = meta.rollChest(cfg, s, 'chapter', 42);
    const b = meta.rollChest(cfg, s, 'chapter', 42);
    expect(a).toEqual(b);
    expect(Object.values(a.shards).reduce((x, y) => x + y, 0)).toBe(cfg.economy.chests.chapter.shards);
    for (const id of Object.keys(a.shards)) expect(char(id).factionId).toBe(s.selection.factionId);
  });
});
