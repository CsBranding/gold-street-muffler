/** Which outfit each crowd family wears — shared by the battle renderer and the idle pre-bake. */
import type { EnemyDef, FactionId, GameConfig } from '../schema/types';
import { bakeKayKitVat, kayKitReady, specFromLook } from './kaykit';
import { copLook, lookFromOutfit, type Look } from './rig';

/** Two outfit variants from the faction roster (leader first) so crowds don't look cloned. */
export function crewLooks(cfg: GameConfig, factionId: FactionId, leaderId: string): Look[] {
  const chars = cfg.characters.characters.filter((c) => c.factionId === factionId);
  const leader = chars.find((c) => c.id === leaderId) ?? chars[0];
  return [leader, ...chars.filter((c) => c !== leader)].slice(0, 2).map((c) => lookFromOutfit(c.outfit, c.skinTone));
}

export function enemyLook(cfg: GameConfig, def: EnemyDef, rivalId: FactionId): Look {
  if (def.side === 'police') {
    const v = def.id.includes('riot') ? 'riot' : def.id.includes('swat') ? 'swat' : def.id.includes('motor') ? 'motor' : 'patrol';
    return copLook(cfg.factions.police.colors, v);
  }
  const rivalChars = cfg.characters.characters.filter((c) => c.factionId === rivalId);
  const rc = rivalChars[Math.min(rivalChars.length - 1, ['rival_shooter', 'rival_enforcer', 'rival_runner', 'rooftop_shooter'].indexOf(def.id))] ?? rivalChars[0];
  const look = lookFromOutfit(rc.outfit, rc.skinTone, def.id === 'rival_enforcer' ? 'bat' : 'pistol');
  if (def.id === 'rival_enforcer') look.bulk = 1.2;
  return look;
}

/** Bake the likely crowd looks one per idle slice, so the next battle starts without a hitch. */
export function warmCrowds(cfg: GameConfig, factionId: FactionId, leaderId: string): void {
  if (!kayKitReady()) return;
  const rivalId = cfg.factions.factions.find((f) => f.id === factionId)!.rivalId;
  const looks = [
    ...crewLooks(cfg, factionId, leaderId),
    ...cfg.enemies.enemies.filter((d) => d.role === 'unit').map((d) => enemyLook(cfg, d, rivalId)),
  ];
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 50));
  const next = () => {
    const look = looks.shift();
    if (!look) return;
    bakeKayKitVat(specFromLook(look));
    idle(next);
  };
  idle(next);
}
