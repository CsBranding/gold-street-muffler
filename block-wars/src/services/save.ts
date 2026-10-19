/**
 * Local save. Structured as one versioned document so it can be synced to a
 * cloud save later without reshaping. Storage backend is pluggable: web
 * localStorage now; Capacitor Preferences plugs in via the same interface
 * for native builds (Phase 4).
 */
import type { BattleMode, FactionId, GameConfig } from '../schema/types';

export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  updatedAt: number;
  currencies: { cash: number; rep: number; ice: number };
  /** highest cleared level number per map id */
  progress: Record<string, number>;
  shards: Record<string, number>;
  upgrades: Record<string, number>;
  selection: {
    factionId: FactionId;
    leaderId: string;
    mode: BattleMode;
    mapId: string;
    /** leader customization (stays inside the faction palette) */
    custom: { skinTone?: string; hat?: string };
    /** finished the first-run faction/character/mode flow */
    onboarded: boolean;
  };
  levelsPlayed: number;
  /** leader id -> level (0/missing = locked unless default) */
  leaderLevels: Record<string, number>;
  /** Hood Base building levels */
  base: Record<string, number>;
  /** last time the app was open (offline income) */
  lastSeen: number;
  login: { lastDay: string; streak: number };
  missions: { day: string; list: { id: string; progress: number; claimed: boolean }[] };
  /** maps whose chapter chest has been earned */
  chaptersCleared: string[];
  /** unopened chest queue */
  chests: { kind: 'chapter' | 'daily'; seed: number }[];
  dailyChestDay: string;
  rankClaimed: number;
  settings: { haptics: boolean; sound: boolean; quality?: number };
}

export interface StorageBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const webStorage: StorageBackend = {
  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode / quota: keep running in memory */
    }
  },
};

const KEY = 'blockwars.save';

export function defaultSave(cfg: GameConfig): SaveData {
  const cur = Object.fromEntries(cfg.economy.currencies.map((c) => [c.id, c.start])) as SaveData['currencies'];
  const red = cfg.factions.factions[0];
  return {
    version: SAVE_VERSION,
    updatedAt: Date.now(),
    currencies: cur,
    progress: {},
    shards: {},
    upgrades: {},
    selection: { factionId: red.id, leaderId: red.defaultLeaderId, mode: 'vs_cops', mapId: cfg.levels.maps[0].id, custom: {}, onboarded: false },
    levelsPlayed: 0,
    leaderLevels: {},
    base: {},
    lastSeen: 0,
    login: { lastDay: '', streak: 0 },
    missions: { day: '', list: [] },
    chaptersCleared: [],
    chests: [],
    dailyChestDay: '',
    rankClaimed: 1,
    settings: { haptics: true, sound: true },
  };
}

export class SaveService {
  data: SaveData;
  constructor(private cfg: GameConfig, private backend: StorageBackend = webStorage) {
    this.data = defaultSave(cfg);
  }
  async load(): Promise<SaveData> {
    const raw = await this.backend.get(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        if (parsed.version === SAVE_VERSION) {
          const base = defaultSave(this.cfg);
          this.data = { ...base, ...parsed, selection: { ...base.selection, ...parsed.selection } } as SaveData;
        }
      } catch {
        /* corrupt save → defaults */
      }
    }
    return this.data;
  }
  async save(): Promise<void> {
    this.data.updatedAt = Date.now();
    await this.backend.set(KEY, JSON.stringify(this.data));
  }
}
