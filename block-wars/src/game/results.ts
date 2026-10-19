import type { GameConfig } from '../schema/types';
import type { Battle } from '../sim/battle';

export interface LevelResult {
  won: boolean;
  stars: number;
  cash: number;
  rep: number;
  ice: number;
  kills: number;
  survivors: number;
  peakCrew: number;
  timeSec: number;
  shards: Record<string, number>;
  firstClear: boolean;
}

export function computeResult(cfg: GameConfig, b: Battle, previouslyCleared: number): LevelResult {
  const r = cfg.economy.levelRewards;
  const won = b.status === 'won';
  const n = b.levelDef.number;
  const survivors = won ? b.crewCount : 0;
  const frac = b.stats.peakCrew > 0 ? survivors / b.stats.peakCrew : 0;
  const stars = won ? r.stars.filter((t) => frac >= t).length : 0;
  const base = b.levelDef.baseCash * Math.pow(1 + r.cashGrowthPerLevel, n - 1);
  const cash = won ? Math.round(base + b.stats.cash + survivors * r.cashPerSurvivor) : Math.round(b.stats.cash * 0.25);
  const firstClear = won && n > previouslyCleared;
  return {
    won,
    stars,
    cash,
    rep: won ? r.repPerLevel * n : 0,
    ice: firstClear ? r.firstClearIceBonus : 0,
    kills: b.stats.kills,
    survivors,
    peakCrew: b.stats.peakCrew,
    timeSec: b.time,
    shards: won ? b.stats.shards : {},
    firstClear,
  };
}
