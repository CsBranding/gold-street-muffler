/** Prints a pacing report for every authored level using the autoplay bot. */
import { loadConfig } from '../src/schema/loadConfig';
import { Battle } from '../src/sim/battle';
import { botSteer } from '../src/sim/bot';
import { buildLoadout } from '../src/sim/loadout';

const cfg = loadConfig();
const mode = (process.argv[2] ?? 'vs_cops') as 'vs_cops';
for (const map of cfg.levels.maps) {
  for (const level of map.levels) {
    const ch = cfg.characters.characters[0];
    const b = new Battle(cfg, map, level, buildLoadout(cfg, ch, mode), Number(process.argv[3] ?? 7));
    const phaseT: Record<string, number> = {};
    const log: string[] = [];
    let bossStart = 0;
    for (let i = 0; i < 240 * 30 && b.status === 'running'; i++) {
      b.setSteerTarget(botSteer(b));
      b.step();
      phaseT[b.phase] = (phaseT[b.phase] ?? 0) + b.dt;
      if (b.phase === 'boss' && !bossStart) bossStart = b.time;
      for (const e of b.drainEvents()) {
        if (e.t === 'banner') log.push(`${b.time.toFixed(1)}s ${e.key} crew=${b.crewCount}`);
        if (e.t === 'reward') log.push(`${b.time.toFixed(1)}s reward ${e.reward.kind}`);
      }
    }
    const fmt = Object.entries(phaseT).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' ');
    console.log(`\n${map.id} L${level.number} → ${b.status} in ${b.time.toFixed(1)}s crew=${b.crewCount} peak=${b.stats.peakCrew} kills=${b.stats.kills} [${fmt}]${bossStart ? ` boss fight ${(b.time - bossStart).toFixed(1)}s hp ${b.level.boss!.hp.toFixed(0)}/${b.level.boss!.maxHp}` : ''}`);
    console.log('  ' + log.join('\n  '));
  }
}
