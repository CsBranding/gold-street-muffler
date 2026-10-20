import type { z } from 'zod';
import type * as S from './schemas';

export type Rarity = z.infer<typeof S.RaritySchema>;
export type FactionId = z.infer<typeof S.FactionIdSchema>;
export type BattleMode = z.infer<typeof S.BattleModeSchema>;

export type FactionsFile = z.infer<typeof S.FactionsFileSchema>;
export type Faction = z.infer<typeof S.FactionSchema>;
export type CharactersFile = z.infer<typeof S.CharactersFileSchema>;
export type Character = z.infer<typeof S.CharacterSchema>;
export type Outfit = z.infer<typeof S.OutfitSchema>;
export type Perk = z.infer<typeof S.PerkSchema>;
export type WeaponsFile = z.infer<typeof S.WeaponsFileSchema>;
export type Weapon = z.infer<typeof S.WeaponSchema>;
export type EnemiesFile = z.infer<typeof S.EnemiesFileSchema>;
export type EnemyDef = z.infer<typeof S.EnemySchema>;
export type BossesFile = z.infer<typeof S.BossesFileSchema>;
export type BossDef = z.infer<typeof S.BossSchema>;
export type BossAttack = z.infer<typeof S.BossAttackSchema>;
export type LevelsFile = z.infer<typeof S.LevelsFileSchema>;
export type MapDef = z.infer<typeof S.MapSchema>;
export type LevelDef = z.infer<typeof S.LevelSchema>;
export type Segment = z.infer<typeof S.SegmentSchema>;
export type HordeSpec = Pick<Extract<Segment, { kind: 'horde' }>, 'side' | 'enemies' | 'columns' | 'pickups' | 'x'>;
export type Gate = z.infer<typeof S.GateSchema>;
export type Reward = z.infer<typeof S.RewardSchema>;
export type ObstacleKind = z.infer<typeof S.ObstacleKindSchema>;
export type EconomyFile = z.infer<typeof S.EconomyFileSchema>;
export type GameFile = z.infer<typeof S.GameFileSchema>;
export type AssetsFile = z.infer<typeof S.AssetsFileSchema>;

/** Everything the game reads, validated and cross-checked. */
export interface GameConfig {
  game: GameFile;
  factions: FactionsFile;
  characters: CharactersFile;
  weapons: WeaponsFile;
  enemies: EnemiesFile;
  bosses: BossesFile;
  levels: LevelsFile;
  economy: EconomyFile;
  assets: AssetsFile;
}
