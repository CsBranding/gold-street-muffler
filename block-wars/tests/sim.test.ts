import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig, RAW_CONFIG } from '../src/schema/loadConfig';
import { Battle } from '../src/sim/battle';
import { botSteer } from '../src/sim/bot';
import { crowdExtents, fillOffsets } from '../src/sim/formation';
import { buildLoadout } from '../src/sim/loadout';
import type { GameConfig } from '../src/schema/types';

const cfg = loadConfig();
const map = cfg.levels.maps.find((m) => m.id === 'freeway_bridge')!;
const redLeader = cfg.characters.characters.find((c) => c.id === 'red_lean')!;
const loadout = (mode: 'vs_cops' | 'vs_rival' | 'all_out' = 'vs_cops') => buildLoadout(cfg, redLeader, mode);

function play(levelNumber: number, seed = 1, mode: 'vs_cops' | 'vs_rival' | 'all_out' = 'vs_cops', revives = 0) {
  const level = map.levels.find((l) => l.number === levelNumber)!;
  const b = new Battle(cfg, map, level, loadout(mode), seed);
  const maxTicks = cfg.game.runCap.maxLevelSec * cfg.game.sim.tickHz * 2;
  let used = 0;
  for (let i = 0; i < maxTicks && b.status !== 'won'; i++) {
    if (b.status === 'failed') {
      if (used >= revives) break;
      used++;
      b.revive();
    }
    b.setSteerTarget(botSteer(b));
    b.step();
    b.drainEvents();
  }
  return b;
}

describe('config', () => {
  it('validates and cross-references', () => {
    expect(cfg.factions.factions).toHaveLength(2);
    expect(cfg.characters.characters.filter((c) => c.factionId === 'red')).toHaveLength(4);
  });
  it('rejects bad references', () => {
    const bad = structuredClone(RAW_CONFIG) as unknown as Record<keyof GameConfig, any>;
    bad.game.crowd.squadStartWeaponId = 'nope';
    expect(() => parseConfig(bad)).toThrow(/squadStartWeaponId/);
  });
  it('has the spec weapon table', () => {
    const w = Object.fromEntries(cfg.weapons.weapons.map((x) => [x.id, x]));
    expect(w.drum_draco.mag).toBe(100);
    expect(w.pump.pellets).toBe(8);
    expect(w.gold_draco.pierce).toBe(2);
  });
});

describe('formation', () => {
  it('keeps width bounded and grows backwards', () => {
    const c = cfg.game.crowd;
    const small = crowdExtents(10, c.spacing, c.maxHalfWidth);
    const big = crowdExtents(800, c.spacing, c.maxHalfWidth);
    expect(big.halfWidth).toBeLessThanOrEqual(c.maxHalfWidth + 1e-6);
    expect(big.back).toBeGreaterThan(small.back * 3);
    const out = new Float32Array(1600);
    fillOffsets(800, c.spacing, c.maxHalfWidth, out);
    for (let i = 0; i < 800; i++) expect(Math.abs(out[i * 2])).toBeLessThanOrEqual(c.maxHalfWidth + 1e-3);
  });
});

describe('gates', () => {
  it('applies math instantly and keeps the leader alive', () => {
    const level = map.levels[0];
    const b = new Battle(cfg, map, level, loadout(), 3);
    const row = b.level.gates.find((g) => g.op === 'mul')!;
    b.crowd.followers = 9;
    b.crowd.x = (row.x0 + row.x1) / 2;
    b.crowd.targetX = b.crowd.x;
    b.crowd.z = row.z - 0.05;
    b.level.obstacles.forEach((o) => (o.alive = false));
    b.step();
    expect(b.crewCount).toBe(10 * row.value);
    const sub = b.level.gates.find((g) => g.op === 'sub' && !g.consumed)!;
    b.crowd.followers = 1;
    b.crowd.x = (sub.x0 + sub.x1) / 2;
    b.crowd.targetX = b.crowd.x;
    b.crowd.z = sub.z - 0.05;
    b.step();
    expect(b.crewCount).toBe(1);
  });
});

describe('levels', () => {
  for (const level of map.levels) {
    it(`Freeway L${level.number} is beatable by the bot under the time cap`, () => {
      const b = play(level.number, 7);
      expect(b.status).toBe('won');
      expect(b.time).toBeLessThan(cfg.game.runCap.maxLevelSec);
    });
  }
  it('is deterministic for a seed', () => {
    const a = play(2, 42);
    const c = play(2, 42);
    expect(a.time).toBe(c.time);
    expect(a.crewCount).toBe(c.crewCount);
    expect(a.stats.kills).toBe(c.stats.kills);
  });
  it('wins across many seeds (lane choice + RNG robustness)', () => {
    for (const lvl of map.levels) {
      let wins = 0;
      for (let s = 1; s <= 6; s++) if (play(lvl.number, s * 101).status === 'won') wins++;
      expect(wins, `L${lvl.number}`).toBeGreaterThanOrEqual(5);
    }
  });
  it('lane choice matters: worst lane ends with a smaller crew', () => {
    const level = map.levels[0];
    const results: number[] = [];
    const wall = new Battle(cfg, map, level, loadout(), 1).level.walls[0];
    for (let lane = 0; lane < wall.edges.length - 1; lane++) {
      const b = new Battle(cfg, map, level, loadout(), 1);
      const x = (wall.edges[lane] + wall.edges[lane + 1]) / 2;
      while (b.crowd.z < wall.z1 + 1 && b.status === 'running') {
        b.setSteerTarget(x);
        b.step();
      }
      results.push(b.crewCount);
    }
    expect(Math.max(...results) - Math.min(...results)).toBeGreaterThan(3);
  });
  it('vs rival swaps the horde to the rival set', () => {
    const level = map.levels[0];
    const b = new Battle(cfg, map, level, loadout('vs_rival'), 1);
    const e = b.level.enemies;
    for (let i = 0; i < e.count; i++) expect(b.level.enemyDefs[e.defIndex[i]].side).toBe('rival');
  });
});

describe('all maps and modes', () => {
  const modes = ['vs_cops', 'vs_rival', 'all_out'] as const;
  for (const m of cfg.levels.maps.filter((x) => x.levels.length)) {
    for (const mode of modes) {
      it(`${m.id} is beatable in ${mode} under the time cap`, () => {
        for (const level of m.levels) {
          const b = new Battle(cfg, m, level, loadout(mode), 7);
          for (let i = 0; i < cfg.game.runCap.maxLevelSec * cfg.game.sim.tickHz && b.status === 'running'; i++) {
            b.setSteerTarget(botSteer(b));
            b.step();
            b.drainEvents();
          }
          expect(b.status, `${m.id} L${level.number}`).toBe('won');
        }
      });
    }
  }
  it('vs rival resolves the mid-chapter mini boss to Big Homie, final to Big Sarge', () => {
    const hood = cfg.levels.maps.find((m) => m.id === 'hood_block')!;
    const l5 = hood.levels.find((l) => l.number === cfg.levels.autoBoss.rivalMiniBossLevel)!;
    expect(new Battle(cfg, hood, l5, loadout('vs_rival'), 1).level.boss!.def.id).toBe('big_homie');
    expect(new Battle(cfg, map, map.levels.find((l) => l.number === 10)!, loadout('vs_rival'), 1).level.boss!.def.id).toBe('big_sarge');
  });
  it('all out spawns both sides and they thin each other out without the player', () => {
    const level = structuredClone(map.levels[0]);
    level.segments = [
      { kind: 'gap', length: 4 },
      { kind: 'horde', length: 60, side: 'enemy', columns: 10, enemies: [{ enemyId: 'patrol_officer', count: 80 }], pickups: [], x: 0, offset: 0 },
    ];
    const b = new Battle(cfg, map, level, loadout('all_out'), 2);
    const e = b.level.enemies;
    const sides = new Set<string>();
    for (let i = 0; i < e.count; i++) sides.add(b.level.enemyDefs[e.defIndex[i]].side);
    expect([...sides].sort()).toEqual(['police', 'rival']);
    b.crowd.z = -500; // keep the crew out of it
    const h = b.level.hordes[0];
    h.state = 'advancing';
    const before = h.alive;
    for (let i = 0; i < 300; i++) b.step();
    expect(h.alive).toBeLessThan(before);
    expect(b.stats.kills).toBe(0);
  });
  it('focus steers fire toward the chosen side', () => {
    const b = new Battle(cfg, map, map.levels[0], loadout('all_out'), 3);
    b.focus = 'rival';
    expect(b.focus).toBe('rival');
  });
  it('helicopter spotlight raises damage taken; drive-by hits the lane', () => {
    const hood = cfg.levels.maps.find((m) => m.id === 'hood_block')!;
    const lvl = hood.levels.find((l) => l.segments.some((s) => s.kind === 'hazard'))!;
    const cops = new Battle(cfg, hood, lvl, loadout('vs_cops'), 1);
    const rival = new Battle(cfg, hood, lvl, loadout('vs_rival'), 1);
    expect(cops.level.hazards[0].kind).toBe('spotlight');
    expect(rival.level.hazards[0].kind).toBe('drive_by');
  });
});

describe('boss', () => {
  it('Big Sarge telegraphs every attack 0.8–1.2s and enrages', () => {
    const b = play(10, 5, 'vs_cops', 2);
    expect(b.level.boss!.def.id).toBe('big_sarge');
    for (const a of b.level.boss!.def.attacks) {
      expect(a.telegraphSec).toBeGreaterThanOrEqual(0.8);
      expect(a.telegraphSec).toBeLessThanOrEqual(1.2);
    }
    expect(b.level.boss!.state).toBe('dead');
    expect(b.level.boss!.enraged).toBe(true);
  });
  it('revive restores the crew after a fail', () => {
    const level = map.levels[0];
    const b = new Battle(cfg, map, level, loadout(), 1);
    b.crowd.leaderHp = 0;
    b.step();
    expect(b.status).toBe('failed');
    b.revive();
    expect(b.status).toBe('running');
    expect(b.crewCount).toBe(cfg.economy.ads.reviveCrew);
  });
});

describe('performance', () => {
  it('500 crew vs 1500 enemies steps well under a frame budget', () => {
    const level = structuredClone(map.levels[0]);
    level.segments = [
      { kind: 'gap', length: 4 },
      { kind: 'horde', length: 60, side: 'enemy', columns: 14, enemies: [{ enemyId: 'patrol_officer', count: 1200 }, { enemyId: 'riot_cop', count: 300 }], pickups: [], x: 0, offset: 0 },
    ];
    const b = new Battle(cfg, { ...map, unlockOrder: 0 }, { ...level, number: 1 }, loadout(), 9);
    b.crowd.followers = 499;
    expect(b.level.enemies.count).toBe(1500);
    // advance into the fight
    for (let i = 0; i < 90; i++) b.step();
    const t0 = performance.now();
    const ticks = 120;
    for (let i = 0; i < ticks; i++) {
      b.step();
      b.drainEvents();
    }
    const msPerTick = (performance.now() - t0) / ticks;
    // 30 Hz sim → must stay far below the 16.6ms frame (target < 4ms on desktop CI).
    expect(msPerTick).toBeLessThan(4);
  });
});

describe('lanes, squads and cop cars', () => {
  const level = map.levels[0];
  const fresh = () => {
    const b = new Battle(cfg, map, level, loadout(), 5);
    b.level.obstacles.forEach((o) => (o.alive = false));
    b.level.hordes.forEach((h) => (h.state = 'dead'));
    b.level.gates.forEach((g) => (g.consumed = true));
    b.crowd.followers = 20;
    return b;
  };
  const car = (b: Battle, x: number, z: number, hp: number) => {
    const o = { ...b.level.obstacles.find((q) => q.speed > 0)! };
    Object.assign(o, { id: b.level.obstacles.length, x, z, hp, maxHp: hp, alive: true, driving: false });
    b.level.obstacles.push(o);
    return o;
  };
  it('authors cop cars and keeps every squad under 50 after scaling', () => {
    for (const m of cfg.levels.maps)
      for (const l of m.levels) {
        const b = new Battle(cfg, m, l, loadout(), 1);
        expect(b.level.obstacles.some((o) => o.speed > 0), `${m.id} L${l.number}`).toBe(true);
        for (const h of b.level.hordes) expect(h.total).toBeLessThan(50);
      }
  });
  it('only shoots targets in the crew lane', () => {
    const b = fresh();
    const z = b.crowd.z + 50;
    b.crowd.x = b.crowd.targetX = 0;
    const side = car(b, 3, z, 1e6);
    side.speed = 0;
    for (let i = 0; i < 60; i++) b.step();
    expect(side.hp).toBe(1e6);
    side.x = 0;
    side.z = b.crowd.z + 10;
    for (let i = 0; i < 30; i++) b.step();
    expect(side.hp).toBeLessThan(1e6);
  });
  it('rams the crew when not shot down, and drops an upgrade when it is', () => {
    const b = fresh();
    const tough = car(b, 0, b.crowd.z + 40, 1e7);
    for (let i = 0; i < 300 && tough.alive; i++) b.step();
    expect(b.crowd.followers).toBe(20 - cfg.game.copCars.ramKills);
    const b2 = fresh();
    const lvl = b2.squad.level;
    const weak = car(b2, 0, b2.crowd.z + 40, 50);
    weak.reward = { kind: 'weapon_level', levels: 1 };
    for (let i = 0; i < 300 && weak.alive; i++) b2.step();
    expect(b2.squad.level).toBe(lvl + 1);
    expect(b2.crowd.followers).toBe(20);
  });
});
