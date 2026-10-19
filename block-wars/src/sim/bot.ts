import type { Battle } from './battle';
import type { GateRT } from './world';

function applyOp(count: number, g: Pick<GateRT, 'op' | 'value'>): number {
  if (g.op === 'add') return count + g.value;
  if (g.op === 'sub') return Math.max(1, count - g.value);
  if (g.op === 'mul') return count * g.value;
  return Math.max(1, Math.floor(count / g.value));
}

/**
 * Reasonable autoplay: reads the same previews a player sees (gate values,
 * lane contents, boss telegraphs) and steers. Used by tests to prove levels
 * are beatable inside the time cap, and by the title screen attract mode.
 */
export function botSteer(b: Battle): number {
  const L = b.level;
  const cz = b.crowd.z;
  const half = b.cfg.game.road.width / 2;
  const boss = L.boss;

  if (boss && boss.state === 'fighting') {
    const tg = boss.telegraph;
    const lanes = [-half * 0.66, 0, half * 0.66];
    const score = (x: number) => {
      let s = 0;
      if (tg && tg.shape === 'circle' && (tg.attack.id === 'baton_slam' || tg.attack.id === 'taser_chain')) s -= Math.max(0, tg.r + b.ext.halfWidth - Math.abs(x - tg.x)) * 30;
      if (tg && tg.shape === 'rect' && tg.attack.id !== 'shield_wall' && x >= tg.x0 && x <= tg.x1) s -= 20;
      for (const g of boss.gas) if (x >= g.x0 && x <= g.x1) s -= 20;
      if (boss.shieldTimer > 0 || (tg && tg.attack.id === 'shield_wall')) s += Math.abs(x - boss.x) > boss.def.flankOffsetM ? 10 : -10;
      s -= Math.abs(x - b.crowd.x) * 0.3;
      return s;
    };
    return lanes.reduce((best, x) => (score(x) > score(best) ? x : best), lanes[0]);
  }

  // Lane choice: simulate each lane's gates/rewards, penalize barricade HP.
  for (const w of L.walls) {
    if (w.z1 < cz || w.z0 - cz > 40) continue;
    if (b.laneLock && b.laneLock.wall === w) return (w.edges[b.laneLock.lane] + w.edges[b.laneLock.lane + 1]) / 2;
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < w.edges.length - 1; i++) {
      const x0 = w.edges[i];
      const x1 = w.edges[i + 1];
      let count = b.crewCount;
      const gates = L.gates.filter((g) => g.z >= w.z0 && g.z <= w.z1 && g.x0 >= x0 - 0.01 && g.x1 <= x1 + 0.01).sort((a, c) => a.z - c.z);
      for (const g of gates) count = applyOp(count, g);
      let score = count;
      for (const o of L.obstacles) {
        if (!o.alive || o.z < w.z0 || o.z > w.z1 || o.x < x0 || o.x > x1) continue;
        if (o.kind === 'barricade') score -= o.hp * 0.05;
        else if (o.reward?.kind === 'recruits') score += o.reward.count;
        else if (o.reward?.kind === 'weapon') score += count; // a better gun is worth about doubling the crew
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return (w.edges[best] + w.edges[best + 1]) / 2;
  }

  // Gate rows: take the best outcome in the next row ahead.
  let nextRowZ = Infinity;
  for (const g of L.gates) if (!g.consumed && g.z > cz && g.z < nextRowZ && g.z - cz < 30) nextRowZ = g.z;
  if (nextRowZ < Infinity) {
    const row = L.gates.filter((g) => g.z === nextRowZ && !g.consumed);
    const pick = row.reduce((a, c) => (applyOp(b.crewCount, c) > applyOp(b.crewCount, a) ? c : a));
    return (pick.x0 + pick.x1) / 2;
  }

  // Loot: aim at the nearest rewarding obstacle, otherwise hold center.
  let target = 0;
  let nearest = Infinity;
  for (const o of L.obstacles) {
    if (!o.alive || !o.reward || o.z < cz || o.z - cz > 25) continue;
    if (o.z - cz < nearest) {
      nearest = o.z - cz;
      target = o.x;
    }
  }
  for (const p of b.pickups) if (p.alive) target = p.x;
  return target;
}
