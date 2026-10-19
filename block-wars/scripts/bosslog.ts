import { loadConfig } from '../src/schema/loadConfig';
import { Battle } from '../src/sim/battle';
import { botSteer } from '../src/sim/bot';
import { buildLoadout } from '../src/sim/loadout';
const cfg = loadConfig();
const map = cfg.levels.maps[0];
const level = map.levels.find((l) => l.isBoss)!;
const b = new Battle(cfg, map, level, buildLoadout(cfg, cfg.characters.characters[0], 'vs_cops'), Number(process.argv[2] ?? 7));
const lost: Record<string, number> = {};
for (let i = 0; i < 200 * 30 && b.status === 'running'; i++) {
  b.setSteerTarget(botSteer(b));
  b.step();
  for (const e of b.drainEvents()) {
    if (b.phase !== 'boss') continue;
    if (e.t === 'crewLost') lost[e.cause] = (lost[e.cause] ?? 0) + e.n;
    if (e.t === 'bossAttack') console.log(`${b.time.toFixed(1)} ${e.attackId} killed=${e.killed} crew=${b.crewCount} x=${b.crowd.x.toFixed(1)} tgx=${e.x.toFixed(1)}`);
    if (e.t === 'weapon' as never) console.log('weapon');
  }
}
console.log(b.status, lost, 'squad', b.squad.weapon.id, 'hp', b.level.boss!.hp.toFixed(0));
