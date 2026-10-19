import type { BossAttack, BossDef, EnemyDef, ObstacleKind, Rarity, Reward } from '../schema/types';

/** Runtime level entities produced by compileLevel(). Coordinates: x lateral, z forward (meters). */

export interface GateRT {
  id: number;
  rowId: number;
  z: number;
  x0: number;
  x1: number;
  op: 'add' | 'sub' | 'mul' | 'div';
  value: number;
  consumed: boolean;
  /** true for gates that hurt (sub/div) — drives grey styling */
  negative: boolean;
}

export interface ObstacleRT {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  hp: number;
  maxHp: number;
  rarity: Rarity;
  reward: Reward | null;
  alive: boolean;
  explodeDamage: number;
  explodeRadius: number;
  /** spawned mid-boss by Call for Backup */
  spawned: boolean;
}

export interface LaneWallRT {
  z0: number;
  z1: number;
  /** x boundaries, left to right, including road edges */
  edges: number[];
}

export interface HordeRT {
  id: number;
  segZ: number;
  anchorZ: number;
  x: number;
  columns: number;
  /** global enemy indices belonging to this horde */
  units: number[];
  alive: number;
  total: number;
  state: 'idle' | 'advancing' | 'contact' | 'dead';
  speed: number;
  slowMult: number;
  slowTimer: number;
  engaged: boolean;
  pushing: boolean;
  /** units' summed bullet HP for the health bar */
  hp: number;
  maxHp: number;
  pickups: PickupSpawn[];
  pickupsReleased: boolean;
}

export interface PickupSpawn {
  x: number;
  at: number;
  reward: Reward;
  rarity: Rarity;
}

export interface PickupRT {
  id: number;
  x: number;
  z: number;
  reward: Reward;
  rarity: Rarity;
  alive: boolean;
}

/** Struct-of-arrays enemy storage — keeps 1,500+ units cheap. */
export interface EnemyStore {
  count: number;
  defIndex: Int16Array;
  hp: Float32Array;
  shield: Float32Array;
  x: Float32Array;
  z: Float32Array;
  alive: Uint8Array;
  horde: Int16Array;
  slot: Int32Array;
}

export interface BannerMarkRT {
  z: number;
  key: BannerKey;
  fired: boolean;
}

export type BannerKey = 'pickLane' | 'grow' | 'runItUp' | 'hold' | 'push' | 'boss' | 'clear' | 'fail' | 'enrage';

export interface TelegraphRT {
  attack: BossAttack;
  t: number;
  total: number;
  /** ground marker: circle (x,z,r) or lane rect (x0..x1, z0..z1) */
  shape: 'circle' | 'rect';
  x: number;
  z: number;
  r: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface GasCloudRT {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  t: number;
  dps: number;
  slowMult: number;
}

export interface BossRT {
  def: BossDef;
  segZ: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  state: 'waiting' | 'fighting' | 'dead';
  attackTimer: number;
  cooldowns: Record<string, number>;
  telegraph: TelegraphRT | null;
  shieldTimer: number;
  enraged: boolean;
  /** seconds since death (drives the slow-mo topple) */
  deadT: number;
  gas: GasCloudRT[];
  lastAttack: string | null;
}

export interface CompiledLevel {
  length: number;
  finishZ: number;
  gates: GateRT[];
  obstacles: ObstacleRT[];
  walls: LaneWallRT[];
  hordes: HordeRT[];
  banners: BannerMarkRT[];
  boss: BossRT | null;
  enemies: EnemyStore;
  enemyDefs: EnemyDef[];
  difficulty: number;
  /** segment z ranges for the renderer (lane previews, scenery) */
  segments: { kind: string; z0: number; z1: number }[];
}
