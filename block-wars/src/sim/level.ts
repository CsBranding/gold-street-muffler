import type { BattleMode, EnemyDef, GameConfig, LevelDef, MapDef, Segment } from '../schema/types';
import type { CompiledLevel, EnemyStore, GateRT, HordeRT, ObstacleRT } from './world';

export function difficultyScale(cfg: GameConfig, map: MapDef, levelNumber: number): number {
  const d = cfg.levels.difficulty;
  return Math.pow(1 + d.growthPerLevel, levelNumber - 1) * (1 + d.mapStep * map.unlockOrder);
}

export function createEnemyStore(capacity: number): EnemyStore {
  return {
    count: 0,
    defIndex: new Int16Array(capacity),
    hp: new Float32Array(capacity),
    shield: new Float32Array(capacity),
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    alive: new Uint8Array(capacity),
    horde: new Int16Array(capacity),
    slot: new Int32Array(capacity),
  };
}

/** Append an enemy, growing the arrays if needed. Returns its index. */
export function addEnemy(store: EnemyStore, defIndex: number, def: EnemyDef, hordeId: number, slot: number): number {
  if (store.count >= store.hp.length) {
    const cap = Math.max(64, store.hp.length * 2);
    const grow = <T extends Int16Array | Float32Array | Uint8Array | Int32Array>(a: T): T => {
      const n = new (a.constructor as { new (n: number): T })(cap);
      n.set(a);
      return n;
    };
    store.defIndex = grow(store.defIndex);
    store.hp = grow(store.hp);
    store.shield = grow(store.shield);
    store.x = grow(store.x);
    store.z = grow(store.z);
    store.alive = grow(store.alive);
    store.horde = grow(store.horde);
    store.slot = grow(store.slot);
  }
  const i = store.count++;
  store.defIndex[i] = defIndex;
  store.hp[i] = def.hp;
  store.shield[i] = def.shieldHp;
  store.alive[i] = 1;
  store.horde[i] = hordeId;
  store.slot[i] = slot;
  return i;
}

/** Map an authored enemy id onto the side the battle mode calls for. */
export function resolveEnemyId(cfg: GameConfig, enemyId: string, side: 'enemy' | 'police' | 'rival', mode: BattleMode, k: number): string {
  const def = cfg.enemies.enemies.find((e) => e.id === enemyId)!;
  let want: 'police' | 'rival';
  if (side !== 'enemy') want = side;
  else if (mode === 'vs_cops') want = 'police';
  else if (mode === 'vs_rival') want = 'rival';
  else want = k % 2 === 0 ? 'police' : 'rival';
  if (def.side === want || !def.counterpartId) return enemyId;
  return def.counterpartId;
}

export function resolveBossId(cfg: GameConfig, bossId: string, mode: BattleMode, levelNumber: number): string {
  if (bossId !== 'auto') return bossId;
  const ab = cfg.levels.autoBoss;
  if (mode === 'vs_rival' && levelNumber === ab.rivalMiniBossLevel) return ab.rivalMiniBossId;
  return ab.finalBossId;
}

function hordeLayout(out: CompiledLevel, h: HordeRT, spacing: number): void {
  const p = { x: 0, z: 0 };
  for (const idx of h.units) {
    hordeSlotOffset(out.enemies.slot[idx], h.columns, spacing, p);
    out.enemies.x[idx] = h.x + p.x;
    out.enemies.z[idx] = h.anchorZ + p.z;
  }
}

/** Hordes form in a packed block; front row (row 0) faces the crew. */
export function hordeSlotOffset(slot: number, columns: number, spacing: number, out: { x: number; z: number }): void {
  const col = slot % columns;
  const row = Math.floor(slot / columns);
  out.x = (col - (columns - 1) / 2) * spacing;
  out.z = row * spacing;
}

export function compileLevel(cfg: GameConfig, map: MapDef, level: LevelDef, mode: BattleMode): CompiledLevel {
  const g = cfg.game;
  const W = g.road.width;
  const half = W / 2;
  const scale = difficultyScale(cfg, map, level.number);
  const enemyDefs = cfg.enemies.enemies;
  const defIdx = new Map(enemyDefs.map((e, i) => [e.id, i]));
  const cruiserDef = enemyDefs.find((e) => e.role === 'obstacle');

  const out: CompiledLevel = {
    length: 0,
    finishZ: 0,
    gates: [],
    obstacles: [],
    walls: [],
    hordes: [],
    banners: [],
    boss: null,
    hazards: [],
    enemies: createEnemyStore(512),
    enemyDefs,
    difficulty: scale,
    segments: [],
  };
  let gateId = 0;
  let rowId = 0;
  let obstacleId = 0;
  const halfWidthOf = (kind: string, laneHalf: number) =>
    kind === 'barricade' ? laneHalf - 0.08 : g.road.obstacleHalfWidth[kind as 'barrel' | 'crate' | 'dumpster' | 'cruiser'];
  const addObstacle = (o: Omit<ObstacleRT, 'id' | 'alive' | 'maxHp' | 'explodeDamage' | 'explodeRadius' | 'spawned'>) => {
    const hp = Math.max(1, Math.round(o.hp * scale));
    const isCruiser = o.kind === 'cruiser' && cruiserDef;
    out.obstacles.push({
      ...o,
      hp,
      maxHp: hp,
      id: obstacleId++,
      alive: true,
      explodeDamage: isCruiser ? cruiserDef.explodeDamage : 0,
      explodeRadius: isCruiser ? cruiserDef.explodeRadius : 0,
      spawned: false,
    });
  };
  const addGate = (z: number, x0: number, x1: number, op: GateRT['op'], value: number, row: number) =>
    out.gates.push({ id: gateId++, rowId: row, z, x0, x1, op, value, consumed: false, negative: op === 'sub' || op === 'div' });

  let z = 0;
  let k = 0;
  const p = { x: 0, z: 0 };
  for (const seg of level.segments as Segment[]) {
    const z0 = z;
    switch (seg.kind) {
      case 'gap':
        z += seg.length;
        break;
      case 'lanes': {
        const n = seg.lanes.length;
        const lw = W / n;
        out.walls.push({ z0, z1: z0 + seg.length, edges: Array.from({ length: n + 1 }, (_, i) => -half + i * lw) });
        out.banners.push({ z: z0 - g.road.bannerLead, key: 'pickLane', fired: false });
        seg.lanes.forEach((lane, i) => {
          const x0 = -half + i * lw;
          const cx = x0 + lw / 2;
          addObstacle({ kind: 'barricade', x: cx, z: z0 + g.road.barricadeDepth, halfW: halfWidthOf('barricade', lw / 2), halfD: g.road.barricadeDepth / 2, hp: lane.barricadeHp, rarity: 'common', reward: null });
          for (const it of lane.items) {
            if (it.type === 'gate') addGate(z0 + it.at, x0, x0 + lw, it.gate.op, it.gate.value, rowId++);
            else addObstacle({ kind: it.kind, x: cx, z: z0 + it.at, halfW: Math.min(halfWidthOf(it.kind, lw / 2), lw / 2 - 0.1), halfD: g.road.obstacleDepth / 2, hp: it.hp, rarity: it.rarity, reward: it.reward });
          }
        });
        z += seg.length;
        break;
      }
      case 'gates': {
        out.banners.push({ z: z0 - g.road.bannerLead, key: 'grow', fired: false });
        for (const row of seg.rows) {
          const n = row.gates.length;
          const gw = W / n;
          const r = rowId++;
          row.gates.forEach((gt, i) => addGate(z0 + row.at, -half + i * gw, -half + (i + 1) * gw, gt.op, gt.value, r));
        }
        z += seg.length;
        break;
      }
      case 'obstacles': {
        out.banners.push({ z: z0 - g.road.bannerLead, key: 'runItUp', fired: false });
        for (const it of seg.items)
          addObstacle({ kind: it.kind, x: it.x * half, z: z0 + it.at, halfW: halfWidthOf(it.kind, half), halfD: g.road.obstacleDepth / 2, hp: it.hp, rarity: it.rarity, reward: it.reward });
        z += seg.length;
        break;
      }
      case 'horde': {
        const hordeId = out.hordes.length;
        const h: HordeRT = {
          id: hordeId,
          segZ: z0,
          anchorZ: z0 + g.road.hordeOffset + seg.offset,
          x: 0,
          columns: seg.columns,
          units: [],
          alive: 0,
          total: 0,
          state: 'idle',
          speed: 0,
          slowMult: 1,
          slowTimer: 0,
          engaged: false,
          pushing: false,
          hp: 0,
          maxHp: 0,
          pickups: seg.pickups.map((pk) => ({ ...pk, x: pk.x * half })),
          pickupsReleased: false,
          rooftop: false,
        };
        const blockW = (seg.columns - 1) * g.horde.spacing;
        h.x = Math.max(-half + blockW / 2 + 0.3, Math.min(half - blockW / 2 - 0.3, seg.x * half));
        let slot = 0;
        let speedSum = 0;
        for (const entry of seg.enemies) {
          const count = Math.max(1, Math.round(entry.count * scale));
          for (let c = 0; c < count; c++) {
            const id = resolveEnemyId(cfg, entry.enemyId, seg.side, mode, k++);
            const di = defIdx.get(id)!;
            const def = enemyDefs[di];
            const idx = addEnemy(out.enemies, di, def, hordeId, slot);
            hordeSlotOffset(slot, h.columns, g.horde.spacing, p);
            out.enemies.x[idx] = h.x + p.x;
            out.enemies.z[idx] = h.anchorZ + p.z;
            h.units.push(idx);
            h.maxHp += def.hp + def.shieldHp;
            speedSum += def.speed;
            slot++;
          }
        }
        // Shields up front: sort so riot units take the front slots.
        h.units.sort((a, b) => enemyDefs[out.enemies.defIndex[b]].shieldHp - enemyDefs[out.enemies.defIndex[a]].shieldHp || a - b);
        h.units.forEach((idx, s) => (out.enemies.slot[idx] = s));
        h.alive = h.total = h.units.length;
        h.hp = h.maxHp;
        h.speed = speedSum / h.units.length;
        h.rooftop = h.speed === 0;
        if (h.rooftop) h.x = Math.sign(seg.x || 1) * (half + 0.9);
        hordeLayout(out, h, g.horde.spacing);
        out.hordes.push(h);
        z += seg.length;
        break;
      }
      case 'hazard': {
        const id = resolveEnemyId(cfg, seg.enemyId, seg.side, mode, 0);
        const di = defIdx.get(id)!;
        const hz = enemyDefs[di].hazard;
        if (hz) out.hazards.push({ id: out.hazards.length, kind: hz.kind, defIndex: di, z0, z1: z0 + seg.length, state: 'waiting', t: 0, x: 0, z: 0, x0: 0, x1: 0 });
        z += seg.length;
        break;
      }
      case 'boss': {
        const bossId = resolveBossId(cfg, seg.bossId, mode, level.number);
        const def = cfg.bosses.bosses.find((b) => b.id === bossId)!;
        const hp = Math.round(def.baseHp * seg.hpMult * scale);
        out.banners.push({ z: z0 - g.road.bannerLead, key: 'boss', fired: false });
        out.boss = {
          def,
          segZ: z0,
          x: 0,
          z: z0 + g.boss.arenaLength * 0.8,
          hp,
          maxHp: hp,
          state: 'waiting',
          attackTimer: def.attackIntervalSec,
          cooldowns: {},
          telegraph: null,
          shieldTimer: 0,
          enraged: false,
          deadT: 0,
          gas: [],
          lastAttack: null,
        };
        z += g.boss.arenaLength;
        break;
      }
    }
    out.segments.push({ kind: seg.kind, z0, z1: z });
  }
  out.length = z;
  out.finishZ = z;
  return out;
}
