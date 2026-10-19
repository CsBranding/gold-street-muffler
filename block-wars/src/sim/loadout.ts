import type { BattleMode, Character, FactionId, GameConfig } from '../schema/types';

/** Everything the battle needs from the meta game, resolved before a run. */
export interface Loadout {
  factionId: FactionId;
  leaderId: string;
  leaderWeaponId: string;
  mode: BattleMode;
  startCrew: number;
  crewDamageMult: number;
  fireRateMult: number;
  leaderHp: number;
  leaderDamageReduction: number;
  /** multiplies recruit packs and cash from obstacles */
  lootMult: number;
  unitHpMult: number;
  /** render-only leader customization */
  cosmetic: { skinTone?: string; hat?: string };
}

/** Upgrade levels keyed by economy upgrade id (Phase 3 fills these from the save). */
export type UpgradeLevels = Partial<Record<string, number>>;

export function buildLoadout(
  cfg: GameConfig,
  character: Character,
  mode: BattleMode,
  upgrades: UpgradeLevels = {},
): Loadout {
  const up = (id: string) => {
    const def = cfg.economy.upgrades.find((u) => u.id === id);
    return def ? (upgrades[id] ?? 0) * def.perLevel : 0;
  };
  const perk = character.perk;
  return {
    factionId: character.factionId,
    leaderId: character.id,
    leaderWeaponId: character.primaryWeaponId,
    mode,
    startCrew: cfg.game.crowd.startCrew + up('starting_crew') + (perk.kind === 'starting_crew' ? perk.value : 0),
    crewDamageMult: 1 + up('crew_damage'),
    fireRateMult: 1 + up('fire_rate') + (perk.kind === 'fire_rate' ? perk.value : 0),
    leaderHp: cfg.game.crowd.leaderHp + up('leader_hp'),
    leaderDamageReduction: perk.kind === 'leader_damage_reduction' ? perk.value : 0,
    lootMult: 1 + up('loot_bonus') + (perk.kind === 'barrel_loot' ? perk.value : 0),
    unitHpMult: 1,
    cosmetic: {},
  };
}
