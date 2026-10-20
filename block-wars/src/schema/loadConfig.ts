import * as S from './schemas';
import type { GameConfig, Reward, Segment } from './types';

import game from '../config/game.json';
import factions from '../config/factions.json';
import characters from '../config/characters.json';
import weapons from '../config/weapons.json';
import enemies from '../config/enemies.json';
import bosses from '../config/bosses.json';
import levels from '../config/levels.json';
import economy from '../config/economy.json';
import assets from '../config/assets.json';

export const RAW_CONFIG = { game, factions, characters, weapons, enemies, bosses, levels, economy, assets };

export class ConfigError extends Error {}

/** Parse + cross-reference every config file. Throws ConfigError listing all problems. */
export function parseConfig(raw: Record<keyof GameConfig, unknown>): GameConfig {
  const errors: string[] = [];
  const parse = <T>(name: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T => {
    const r = schema.safeParse(value);
    if (!r.success) {
      for (const i of r.error.issues) errors.push(`${name}.json ${i.path.join('.')}: ${i.message}`);
      return undefined as T;
    }
    return r.data;
  };
  const cfg: GameConfig = {
    game: parse('game', S.GameFileSchema, raw.game),
    factions: parse('factions', S.FactionsFileSchema, raw.factions),
    characters: parse('characters', S.CharactersFileSchema, raw.characters),
    weapons: parse('weapons', S.WeaponsFileSchema, raw.weapons),
    enemies: parse('enemies', S.EnemiesFileSchema, raw.enemies),
    bosses: parse('bosses', S.BossesFileSchema, raw.bosses),
    levels: parse('levels', S.LevelsFileSchema, raw.levels),
    economy: parse('economy', S.EconomyFileSchema, raw.economy),
    assets: parse('assets', S.AssetsFileSchema, raw.assets),
  };
  if (errors.length) throw new ConfigError(errors.join('\n'));

  // ---- cross references
  const weaponIds = new Set(cfg.weapons.weapons.map((w) => w.id));
  const enemyIds = new Set(cfg.enemies.enemies.map((e) => e.id));
  const bossIds = new Set(cfg.bosses.bosses.map((b) => b.id));
  const charIds = new Set(cfg.characters.characters.map((c) => c.id));
  const dup = (name: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const i of ids) {
      if (seen.has(i)) errors.push(`duplicate ${name} id ${i}`);
      seen.add(i);
    }
  };
  dup('weapon', cfg.weapons.weapons.map((w) => w.id));
  dup('enemy', [...enemyIds]);
  dup('character', cfg.characters.characters.map((c) => c.id));
  dup('map', cfg.levels.maps.map((m) => m.id));

  if (!weaponIds.has(cfg.game.crowd.squadStartWeaponId)) errors.push(`game.crowd.squadStartWeaponId unknown`);
  for (const f of cfg.factions.factions) {
    if (!charIds.has(f.defaultLeaderId)) errors.push(`faction ${f.id} defaultLeaderId ${f.defaultLeaderId} unknown`);
    const n = cfg.characters.characters.filter((c) => c.factionId === f.id).length;
    if (n !== 4) errors.push(`faction ${f.id} must have 4 leaders (has ${n})`);
  }
  for (const c of cfg.characters.characters) {
    if (!weaponIds.has(c.primaryWeaponId)) errors.push(`character ${c.id} weapon ${c.primaryWeaponId} unknown`);
  }
  for (const e of cfg.enemies.enemies)
    if (e.counterpartId && !enemyIds.has(e.counterpartId)) errors.push(`enemy ${e.id} counterpart ${e.counterpartId} unknown`);
  const ab = cfg.levels.autoBoss;
  if (!bossIds.has(ab.finalBossId)) errors.push(`levels.autoBoss.finalBossId ${ab.finalBossId} unknown`);
  if (!bossIds.has(ab.rivalMiniBossId)) errors.push(`levels.autoBoss.rivalMiniBossId ${ab.rivalMiniBossId} unknown`);
  for (const w of cfg.economy.armoryWeapons) if (!weaponIds.has(w)) errors.push(`economy.armoryWeapons: unknown weapon ${w}`);
  if (cfg.economy.armoryWeapons[0] !== cfg.game.crowd.squadStartWeaponId) errors.push('economy.armoryWeapons[0] must be the squad start weapon');
  const armory = cfg.economy.hoodBase.find((b) => b.id === 'armory');
  if (armory && armory.maxLevel > cfg.economy.armoryWeapons.length - 1) errors.push('armory maxLevel exceeds armoryWeapons');
  for (const b of cfg.bosses.bosses)
    for (const a of b.attacks)
      for (const s of a.spawn) if (!enemyIds.has(s.enemyId)) errors.push(`boss ${b.id} spawns unknown ${s.enemyId}`);

  const checkReward = (where: string, r: Reward | null) => {
    if (!r) return;
    if (r.kind === 'weapon' && !weaponIds.has(r.weaponId)) errors.push(`${where}: unknown weapon ${r.weaponId}`);
    if (r.kind === 'leader_shard' && !charIds.has(r.leaderId)) errors.push(`${where}: unknown leader ${r.leaderId}`);
  };
  const checkSegment = (where: string, s: Segment) => {
    if (s.kind === 'lanes') s.lanes.forEach((l, i) => l.items.forEach((it) => it.type === 'obstacle' && checkReward(`${where} lane${i}`, it.reward)));
    if (s.kind === 'obstacles') s.items.forEach((it) => checkReward(where, it.reward));
    if (s.kind === 'horde') {
      s.enemies.forEach((e) => !enemyIds.has(e.enemyId) && errors.push(`${where}: unknown enemy ${e.enemyId}`));
      s.pickups.forEach((p) => checkReward(where, p.reward));
    }
    if (s.kind === 'squads') {
      s.squads.forEach((q) => q.enemies.forEach((e) => !enemyIds.has(e.enemyId) && errors.push(`${where}: unknown enemy ${e.enemyId}`)));
      s.cars.forEach((c) => checkReward(where, c.reward));
    }
    if (s.kind === 'boss' && s.bossId !== 'auto' && !bossIds.has(s.bossId)) errors.push(`${where}: unknown boss ${s.bossId}`);
  };
  for (const m of cfg.levels.maps)
    for (const l of m.levels) {
      l.segments.forEach((s, i) => checkSegment(`${m.id} L${l.number} seg${i}`, s));
      if (l.isBoss !== l.segments.some((s) => s.kind === 'boss')) errors.push(`${m.id} L${l.number}: isBoss mismatch`);
    }
  if (errors.length) throw new ConfigError(errors.join('\n'));
  return cfg;
}

let cached: GameConfig | null = null;
export function loadConfig(): GameConfig {
  return (cached ??= parseConfig(RAW_CONFIG as Record<keyof GameConfig, unknown>));
}
