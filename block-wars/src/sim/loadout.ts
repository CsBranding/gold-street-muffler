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
  /** Garage: pickup vehicles last longer */
  vehicleDurationMult: number;
  /** Armory: the squad's starting gun */
  squadWeaponId: string;
  /** render-only leader customization */
  cosmetic: { skinTone?: string; hat?: string };
}

/** Upgrade levels keyed by economy upgrade id (Phase 3 fills these from the save). */
export type UpgradeLevels = Partial<Record<string, number>>;

/** Roster + Hood Base state that shapes a run (Phase 3). */
export interface MetaState {
  leaderLevel?: number;
  base?: Partial<Record<string, number>>;
}

export function buildLoadout(
  cfg: GameConfig,
  character: Character,
  mode: BattleMode,
  upgrades: UpgradeLevels = {},
  meta: MetaState = {},
): Loadout {
  const r = cfg.economy.roster;
  const lvl = Math.max(1, meta.leaderLevel ?? 1);
  const perkMult = 1 + (lvl - 1) * r.perkPerLevel;
  const bld = (id: string) => {
    const def = cfg.economy.hoodBase.find((b) => b.id === id);
    return def ? (meta.base?.[id] ?? 0) * def.perLevel : 0;
  };
  const armoryLevel = Math.min(cfg.economy.armoryWeapons.length - 1, Math.round(bld('armory')));
  const up = (id: string) => {
    const def = cfg.economy.upgrades.find((u) => u.id === id);
    return def ? (upgrades[id] ?? 0) * def.perLevel : 0;
  };
  const perk = { ...character.perk, value: character.perk.value * perkMult };
  return {
    factionId: character.factionId,
    leaderId: character.id,
    leaderWeaponId: character.primaryWeaponId,
    mode,
    startCrew: cfg.game.crowd.startCrew + up('starting_crew') + (perk.kind === 'starting_crew' ? Math.round(perk.value) : 0),
    crewDamageMult: 1 + up('crew_damage'),
    fireRateMult: 1 + up('fire_rate') + (perk.kind === 'fire_rate' ? perk.value : 0),
    leaderHp: cfg.game.crowd.leaderHp + up('leader_hp') + (lvl - 1) * r.leaderHpPerLevel,
    leaderDamageReduction: perk.kind === 'leader_damage_reduction' ? Math.min(0.6, perk.value) : 0,
    lootMult: 1 + up('loot_bonus') + (perk.kind === 'barrel_loot' ? perk.value : 0),
    unitHpMult: 1 + bld('gym'),
    vehicleDurationMult: 1 + bld('garage'),
    squadWeaponId: cfg.economy.armoryWeapons[armoryLevel],
    cosmetic: {},
  };
}
