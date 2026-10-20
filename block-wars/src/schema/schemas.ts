/**
 * PHASE 0 — FROZEN CONFIG SCHEMA.
 *
 * Every tunable number in BLOCK WARS lives in src/config/*.json and is
 * validated against these schemas at boot and in tests. TypeScript types are
 * inferred from the schemas (see types.ts) and JSON Schema files are emitted
 * to /schemas via `npm run schemas`.
 *
 * Changing a schema is a breaking change: bump SCHEMA_VERSION and migrate
 * the config + save data.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const id = z.string().regex(/^[a-z0-9_]+$/, 'ids are snake_case');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex color #rrggbb');
const pos = z.number().positive();
const nonNeg = z.number().min(0);
const frac = z.number().min(0).max(1);

export const RaritySchema = z.enum(['common', 'rare', 'epic', 'legendary']);
export const FactionIdSchema = z.enum(['red', 'blue']);
export const BattleModeSchema = z.enum(['vs_cops', 'vs_rival', 'all_out']);

// ---------------------------------------------------------------- factions
export const FactionSchema = z.object({
  id: FactionIdSchema,
  displayName: z.string().min(1),
  shortName: z.string().min(1),
  slogan: z.string(),
  colors: z.object({
    primary: hex,
    secondary: hex,
    accent: hex,
    /** banner outline + UI chrome */
    ui: hex,
  }),
  rivalId: FactionIdSchema,
  defaultLeaderId: id,
});
export const FactionsFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  police: z.object({
    displayName: z.string(),
    colors: z.object({ primary: hex, secondary: hex, lightRed: hex, lightBlue: hex }),
  }),
  factions: z.array(FactionSchema).length(2),
});

// -------------------------------------------------------------- characters
export const PerkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fire_rate'), value: z.number() }),
  z.object({ kind: z.literal('starting_crew'), value: z.number().int() }),
  z.object({ kind: z.literal('barrel_loot'), value: z.number() }),
  z.object({ kind: z.literal('leader_damage_reduction'), value: frac }),
]);

/** Low-poly placeholder outfit description; final art swaps via assets.json. */
export const OutfitSchema = z.object({
  hat: z.enum(['snapback_back', 'bandana', 'beanie', 'none', 'durag', 'fitted']),
  hatColor: hex,
  top: z.enum(['hoodie_open', 'flannel_open', 'tee', 'jersey', 'puffer']),
  topColor: hex,
  shirtColor: hex,
  pantsColor: hex,
  shoeColor: hex,
  shoeAccent: hex,
  chain: z.boolean(),
  sunglasses: z.boolean(),
  pocketBandana: z.boolean(),
  tattoos: z.array(z.enum(['neck', 'hands', 'forearms', 'face'])),
});

export const CharacterSchema = z.object({
  id,
  factionId: FactionIdSchema,
  displayName: z.string(),
  bio: z.string(),
  unlock: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('default') }),
    z.object({ kind: z.literal('shards'), shards: z.number().int().positive() }),
  ]),
  perk: PerkSchema,
  primaryWeaponId: id,
  idlePose: z.enum(['lean_phone', 'arms_crossed_sleeve', 'hands_in_pockets', 'chin_up']),
  skinTone: hex,
  outfit: OutfitSchema,
});
export const CharactersFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  customization: z.object({
    skinTones: z.array(hex).min(1),
    hairStyles: z.array(z.string()).min(1),
    faceTattoos: z.array(z.string()).min(1),
    /** outfit pieces must stay within faction palette; index into these */
    outfitPieces: z.object({ hats: z.array(z.string()), tops: z.array(z.string()), shoes: z.array(z.string()) }),
  }),
  characters: z.array(CharacterSchema),
});

// ----------------------------------------------------------------- weapons
export const WeaponSchema = z.object({
  id,
  displayName: z.string(),
  fireMode: z.enum(['semi', 'auto', 'pump']),
  damage: pos,
  pellets: z.number().int().positive(),
  ratePerSec: pos,
  spread: z.enum(['low', 'med', 'high', 'cone']),
  mag: z.number().int().positive(),
  reloadSec: pos,
  rangeM: pos,
  rarity: RaritySchema,
  pierce: z.number().int().min(0),
  critBonus: frac,
  knockback: nonNeg,
  /** enemy speed multiplier applied while being hit (1 = none) */
  slowMult: z.number().min(0).max(1),
  /** extra spread (accuracy loss) per consecutive shot, capped */
  muzzleClimb: nonNeg,
  /** weapon class drives screen shake and sound bank */
  class: z.enum(['pistol', 'smg', 'rifle', 'shotgun', 'lmg']),
  special: z.string(),
  skins: z.array(z.enum(['default', 'chrome', 'gold', 'iced_out'])),
});
export const WeaponsFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  /** upgrade level 1..5 damage multipliers (index 0 = level 1) */
  levelDamageMult: z.array(pos).length(5),
  levelRateMult: z.array(pos).length(5),
  spreadValues: z.object({ low: nonNeg, med: nonNeg, high: nonNeg, cone: nonNeg }),
  maxMuzzleClimb: nonNeg,
  critMultiplier: pos,
  baseCritChance: frac,
  shakeByClass: z.object({ pistol: nonNeg, smg: nonNeg, rifle: nonNeg, shotgun: nonNeg, lmg: nonNeg }),
  weapons: z.array(WeaponSchema),
});

// ----------------------------------------------------------------- enemies
export const EnemySchema = z.object({
  id,
  displayName: z.string(),
  side: z.enum(['police', 'rival']),
  role: z.enum(['unit', 'obstacle', 'hazard']),
  hp: pos,
  speed: nonNeg,
  /** damage per second dealt while target within range */
  dps: nonNeg,
  rangeM: nonNeg,
  meleeDps: nonNeg,
  /** shield HP absorbing frontal shots (0 = no shield) */
  shieldHp: nonNeg,
  /** half-angle in degrees inside which the shield blocks */
  shieldArcDeg: z.number().min(0).max(180),
  /** damage multiplier applied to incoming bullets (armor) */
  armorMult: z.number().positive(),
  scale: pos,
  /** death splash damage (cruiser explosion) */
  explodeDamage: nonNeg,
  explodeRadius: nonNeg,
  /** hazard specific */
  hazard: z
    .object({
      kind: z.enum(['spotlight', 'drive_by']),
      damageTakenMult: z.number().positive(),
      dps: nonNeg,
      telegraphSec: nonNeg,
      durationSec: pos,
    })
    .optional(),
  /** cash dropped per kill */
  cash: nonNeg,
  /** equivalent unit on the other side (police <-> rival) used by battle modes */
  counterpartId: id.nullable(),
});
export const EnemiesFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  enemies: z.array(EnemySchema),
});

// ------------------------------------------------------------------ bosses
export const BossAttackSchema = z.object({
  id: z.enum(['baton_slam', 'shield_wall', 'taser_chain', 'call_backup', 'tear_gas', 'drum_spray', 'summon_runners']),
  displayName: z.string(),
  weight: nonNeg,
  telegraphSec: z.number().min(0.8).max(1.2),
  cooldownSec: pos,
  radius: nonNeg,
  durationSec: nonNeg,
  dps: nonNeg,
  /** taser chain min/max units */
  minUnits: z.number().int().min(0),
  maxUnits: z.number().int().min(0),
  /** call backup / summon */
  spawn: z.array(z.object({ enemyId: id, count: z.number().int().positive() })),
  leaderDamage: nonNeg,
  slowMult: z.number().min(0).max(1),
  /** spray cone half angle */
  coneDeg: nonNeg,
});
export const BossSchema = z.object({
  id,
  displayName: z.string(),
  side: z.enum(['police', 'rival']),
  heightMultOfCrew: pos,
  baseHp: pos,
  attacks: z.array(BossAttackSchema).min(1),
  /** time between attack decisions */
  attackIntervalSec: pos,
  enrage: z.object({ hpFrac: frac, attackSpeedMult: pos }),
  weakPoint: z.object({ chance: frac, mult: pos, onlyWhenShieldDown: z.boolean() }),
  /** crew lateral offset needed to flank the shield */
  flankOffsetM: pos,
  /** lateral tracking speed toward the crew (m/s); frozen while shielding */
  trackSpeed: nonNeg,
  standoffM: pos,
  contactDps: nonNeg,
  cash: nonNeg,
  lootBurst: z.number().int().min(0),
});
export const BossesFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  bosses: z.array(BossSchema),
});

// ------------------------------------------------------------------ levels
export const GateOpSchema = z.enum(['add', 'sub', 'mul', 'div']);
export const GateSchema = z.object({ op: GateOpSchema, value: pos });

export const RewardSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('weapon'), weaponId: id }),
  z.object({ kind: z.literal('weapon_level'), levels: z.number().int().positive() }),
  z.object({ kind: z.literal('recruits'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('leader_shard'), leaderId: id, count: z.number().int().positive() }),
  z.object({ kind: z.literal('vehicle'), vehicle: z.enum(['lowrider', 'dirt_bike']) }),
  z.object({ kind: z.literal('drum_mag') }),
  z.object({ kind: z.literal('armor_vest') }),
  z.object({ kind: z.literal('cash'), amount: pos }),
]);
export const ObstacleKindSchema = z.enum(['barrel', 'crate', 'dumpster', 'cruiser', 'barricade']);
export const ObstacleSchema = z.object({
  kind: ObstacleKindSchema,
  /** base HP before difficulty scaling */
  hp: pos,
  /** lateral position in lane-widths from road center (-1..1 = road edges) */
  x: z.number().min(-1).max(1),
  /** forward offset in meters from segment start */
  at: nonNeg,
  rarity: RaritySchema,
  reward: RewardSchema.nullable(),
  /** >0: a vehicle that drives down its lane at the crew (m/s); rams if not shot down */
  speed: nonNeg.default(0),
});
export const LaneItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gate'), at: nonNeg, gate: GateSchema }),
  z.object({
    type: z.literal('obstacle'),
    at: nonNeg,
    kind: ObstacleKindSchema,
    hp: pos,
    rarity: RaritySchema,
    reward: RewardSchema.nullable(),
  }),
]);
export const HordeEntrySchema = z.object({ enemyId: id, count: z.number().int().positive() });
export const SegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gap'), length: pos }),
  z.object({
    kind: z.literal('lanes'),
    length: pos,
    lanes: z
      .array(z.object({ barricadeHp: pos, items: z.array(LaneItemSchema) }))
      .min(2)
      .max(3),
  }),
  z.object({
    kind: z.literal('gates'),
    length: pos,
    rows: z.array(z.object({ at: nonNeg, gates: z.array(GateSchema).min(1).max(3) })),
  }),
  z.object({ kind: z.literal('obstacles'), length: pos, items: z.array(ObstacleSchema) }),
  z.object({
    kind: z.literal('horde'),
    length: pos,
    /** who fills the horde: 'enemy' resolves by battle mode */
    side: z.enum(['enemy', 'police', 'rival']),
    enemies: z.array(HordeEntrySchema).min(1),
    columns: z.number().int().positive(),
    /** pickups that drop in mid-fight */
    pickups: z.array(z.object({ at: nonNeg, x: z.number().min(-1).max(1), reward: RewardSchema, rarity: RaritySchema })),
    /** lateral center in half-road units (-1..1): flankers come up a side lane, rooftop shooters sit on the edge */
    x: z.number().min(-1).max(1).default(0),
    /** extra forward offset from the segment start (m) */
    offset: nonNeg.default(0),
  }),
  z.object({
    kind: z.literal('squads'),
    length: pos,
    side: z.enum(['enemy', 'police', 'rival']),
    /** small squads, each standing in one lane (-1 left, 0 middle, 1 right) */
    squads: z.array(
      z.object({ at: nonNeg, lane: z.number().int().min(-1).max(1), columns: z.number().int().positive().default(4), enemies: z.array(HordeEntrySchema).min(1) }),
    ),
    /** cop cars that drive down a lane at the crew: shoot them for the reward, or get rammed */
    cars: z
      .array(z.object({ at: nonNeg, lane: z.number().int().min(-1).max(1), hp: pos, speed: pos, rarity: RaritySchema, reward: RewardSchema.nullable() }))
      .default([]),
  }),
  z.object({
    kind: z.literal('hazard'),
    length: pos,
    /** helicopter (spotlight) or lowrider_driveby; resolved by battle mode like hordes */
    enemyId: id,
    side: z.enum(['enemy', 'police', 'rival']),
  }),
  z.object({
    kind: z.literal('boss'),
    /** 'auto' resolves by battle mode (Big Sarge / Big Homie) */
    bossId: z.union([id, z.literal('auto')]),
    hpMult: pos,
  }),
]);
export const LevelSchema = z.object({
  number: z.number().int().min(1).max(10),
  name: z.string(),
  isBoss: z.boolean(),
  /** roughly how long the level should take; tests assert under the hard cap */
  targetSec: pos,
  baseCash: nonNeg,
  segments: z.array(SegmentSchema).min(1),
});
export const MapSchema = z.object({
  id,
  displayName: z.string(),
  unlockOrder: z.number().int().min(0),
  theme: z.object({
    sky: hex,
    fog: hex,
    fogNear: nonNeg,
    fogFar: pos,
    ground: hex,
    road: hex,
    roadLine: hex,
    edge: z.enum(['water', 'sidewalk', 'gravel', 'pier']),
    edgeColor: hex,
    sun: hex,
    sunIntensity: nonNeg,
    ambient: hex,
    ambientIntensity: nonNeg,
    props: z.array(z.string()),
    night: z.boolean(),
  }),
  /** levels authored so far; level 10 is the boss */
  levels: z.array(LevelSchema),
});
export const LevelsFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  difficulty: z.object({
    /** enemy counts and obstacle HP scale (1+growth)^(level-1) */
    growthPerLevel: nonNeg,
    /** extra multiplier per map in unlock order */
    mapStep: nonNeg,
  }),
  /** how `bossId: "auto"` resolves */
  autoBoss: z.object({ finalBossId: id, rivalMiniBossId: id, rivalMiniBossLevel: z.number().int().min(1).max(10) }),
  maps: z.array(MapSchema).min(1),
});

// ----------------------------------------------------------------- economy
export const CurrencyIdSchema = z.enum(['cash', 'rep', 'ice']);
export const UpgradeSchema = z.object({
  id: z.enum(['starting_crew', 'crew_damage', 'fire_rate', 'leader_hp', 'loot_bonus', 'offline_income']),
  displayName: z.string(),
  maxLevel: z.number().int().positive(),
  baseCost: pos,
  costGrowth: pos,
  /** effect added per level */
  perLevel: z.number(),
});
export const EconomyFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  currencies: z.array(z.object({ id: CurrencyIdSchema, displayName: z.string(), color: hex, start: nonNeg })).length(3),
  levelRewards: z.object({
    cashGrowthPerLevel: nonNeg,
    repPerLevel: nonNeg,
    cashPerSurvivor: nonNeg,
    firstClearIceBonus: nonNeg,
    stars: z.array(frac).length(3),
  }),
  upgrades: z.array(UpgradeSchema),
  roster: z.object({
    /** shards needed to go from level i+1 to i+2 */
    shardsPerLeaderLevel: z.array(z.number().int().positive()),
    /** cash cost alongside the shards, same indexing */
    cashPerLeaderLevel: z.array(nonNeg),
    maxLeaderLevel: z.number().int().positive(),
    /** perk value grows by this fraction per leader level above 1 */
    perkPerLevel: nonNeg,
    leaderHpPerLevel: nonNeg,
  }),
  /** Rep is XP: ranks grant Ice */
  rank: z.object({ repBase: pos, repGrowth: pos, iceReward: nonNeg }),
  /** Armory level N unlocks armoryWeapons[N] as the squad's starting gun */
  armoryWeapons: z.array(id).min(1),
  missions: z.array(
    z.object({
      id,
      text: z.string(),
      stat: z.enum(['kills', 'gates', 'levels', 'bosses', 'recruits', 'cash', 'obstacles', 'stars']),
      target: pos,
      cash: nonNeg,
      ice: nonNeg,
    }),
  ),
  chests: z.object({
    chapter: z.object({ cash: nonNeg, ice: nonNeg, shards: z.number().int().min(0), leaders: z.number().int().min(1) }),
    daily: z.object({ cash: nonNeg, ice: nonNeg, shards: z.number().int().min(0), leaders: z.number().int().min(1) }),
  }),
  hoodBase: z.array(
    z.object({
      id: z.enum(['corner_store', 'gym', 'armory', 'garage']),
      displayName: z.string(),
      blurb: z.string(),
      maxLevel: z.number().int().positive(),
      baseCost: pos,
      costGrowth: pos,
      effect: z.string(),
      perLevel: z.number(),
    }),
  ),
  offlineIncome: z.object({ basePerHour: nonNeg, capHours: pos, minMinutes: nonNeg }),
  ads: z.object({
    interstitialFreeLevels: z.number().int().min(0),
    interstitialEveryNLevels: z.number().int().positive(),
    rewarded: z.array(z.enum(['double_loot', 'revive', 'daily_chest', 'double_offline'])),
    reviveCrew: z.number().int().positive(),
    maxRevivesPerLevel: z.number().int().min(0),
  }),
  iap: z.array(z.object({ id, displayName: z.string(), priceUsd: pos, grants: z.record(z.string(), z.number()) })),
  daily: z.object({ loginStreakCash: z.array(nonNeg).min(1), missionsPerDay: z.number().int().positive() }),
});

// -------------------------------------------------------------- game tunables
export const GameFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  title: z.string(),
  sim: z.object({
    tickHz: z.number().int().positive(),
    maxStepsPerFrame: z.number().int().positive(),
    maxShotsPerTick: z.number().int().positive(),
    targetCandidates: z.number().int().positive(),
    seed: z.number().int(),
  }),
  road: z.object({
    width: pos,
    laneWallHeight: pos,
    gateDepth: pos,
    obstacleDepth: pos,
    barricadeDepth: pos,
    obstacleHalfWidth: z.object({ barrel: pos, crate: pos, dumpster: pos, cruiser: pos }),
    /** banner lead distance before a segment starts */
    bannerLead: nonNeg,
    /** distance from horde segment start to the horde's front row */
    hordeOffset: nonNeg,
  }),
  crowd: z.object({
    runSpeed: pos,
    chargeSpeed: pos,
    steerSpeed: pos,
    spacing: pos,
    maxHalfWidth: pos,
    unitHp: pos,
    leaderHp: pos,
    meleeDps: nonNeg,
    contactGap: nonNeg,
    engageRange: pos,
    leaderScale: pos,
    maxCrew: z.number().int().positive(),
    reviveInvulnSec: nonNeg,
    /** extra target score per meter a target sits outside the crowd's width */
    lateralTargetPenalty: nonNeg,
    /** fire from squads in other lanes lands at this fraction (they can't be shot back) */
    offLaneFireMult: frac,
    /** half-angle of the forward targeting cone */
    targetConeDeg: z.number().min(1).max(89),
    startCrew: z.number().int().min(0),
    squadStartWeaponId: id,
  }),
  horde: z.object({
    spacing: pos,
    aggroRange: pos,
    pushThreshold: pos,
    flankDistance: nonNeg,
    pickupDriftSpeed: nonNeg,
    /** rooftop shooters stand this high above the road */
    rooftopHeight: nonNeg,
    pushbackOnRevive: nonNeg,
  }),
  pickups: z.object({
    armorUnitHpMult: pos,
    armorLeaderReduction: frac,
    drumMagMult: pos,
    lowrider: z.object({ durationSec: pos, speedMult: pos, damageMult: pos }),
    dirtBike: z.object({ durationSec: pos, speedMult: pos, invulnerable: z.boolean() }),
    rarityLootMult: z.object({ common: pos, rare: pos, epic: pos, legendary: pos }),
  }),
  boss: z.object({ arenaLength: pos, slowMoSec: pos, slowMoScale: pos }),
  camera: z.object({
    fov: pos,
    height: pos,
    back: pos,
    lookAhead: pos,
    zoomPerSqrtCrew: nonNeg,
    maxZoom: pos,
    followLerp: frac,
    bossPushIn: pos,
  }),
  render: z.object({
    maxCrewInstances: z.number().int().positive(),
    maxEnemyInstances: z.number().int().positive(),
    maxTracers: z.number().int().positive(),
    maxParticles: z.number().int().positive(),
    maxDamageNumbers: z.number().int().positive(),
    maxLabels: z.number().int().positive(),
    tracerLife: pos,
    tracerWidth: pos,
    /** units farther than this from the camera use the low-detail mesh */
    lodDistance: pos,
    /** beyond this distance from the camera units use the cheapest LOD */
    farDistance: pos,
    /** cap on full-detail units per outfit per frame (big crews trail toward the camera) */
    maxHiInstances: z.number().int().positive(),
    /** adaptive quality: step down when the smoothed frame time stays above this (ms) */
    adaptiveFrameMs: pos,
    adaptiveWindowSec: pos,
    maxDamageNumbersPerFlush: z.number().int().positive(),
    damageNumberLife: pos,
    pixelRatioCap: pos,
    shadows: z.boolean(),
    shadowMapSize: z.number().int().positive(),
    exposure: pos,
    bloom: z.boolean(),
    bloomStrength: nonNeg,
    bloomThreshold: nonNeg,
    /** knocked-down bodies per unit type before recycling */
    maxCorpses: z.number().int().positive(),
    corpseLife: pos,
  }),
  input: z.object({ dragMetersPerScreen: pos }),
  rarityColors: z.object({ common: hex, rare: hex, epic: hex, legendary: hex }),
  gateColors: z.object({ negative: hex, negativeText: hex }),
  banners: z.object({
    durationSec: pos,
    text: z.object({
      pickLane: z.string(),
      grow: z.string(),
      runItUp: z.string(),
      hold: z.string(),
      push: z.string(),
      boss: z.string(),
      clear: z.string(),
      fail: z.string(),
      enrage: z.string(),
    }),
  }),
  runCap: z.object({ maxLevelSec: pos }),
  allOut: z.object({
    /** fraction of each side's dps that goes into the other side when both share a horde */
    infightMult: frac,
    /** rival raiders that show up to fight Big Sarge */
    bossRivalCount: z.number().int().min(0),
    /** rival dps multiplier against the boss */
    bossDamageMult: nonNeg,
    /** target score penalty (m) for the side the player isn't focusing */
    focusPenalty: nonNeg,
  }),
  copCars: z.object({
    /** distance at which a parked cop car starts driving at the crew */
    triggerRange: pos,
    /** crew knocked out when one rams the crowd */
    ramKills: z.number().int().min(0),
  }),
  hazards: z.object({
    spotlightWidth: pos,
    spotlightSweepSpeed: pos,
    driveBySpeed: pos,
  }),
  audio: z.object({ master: frac, sfx: frac, music: frac, bpm: pos, maxShotVoicesPerSec: pos }),
  feel: z.object({
    /** brief time-scale dip on big impacts */
    hitStopSec: nonNeg,
    hitStopScale: frac,
    recruitLeapSec: pos,
    recruitLeapHeight: nonNeg,
    maxDebris: z.number().int().positive(),
    debrisLife: pos,
  }),
  /** real-time delays before result/fail screens appear */
  flow: z.object({ winDelaySec: nonNeg, failDelaySec: nonNeg }),
});

// ---------------------------------------------------------- asset manifest
export const AssetEntrySchema = z.object({
  /** null → use the procedural low-poly placeholder */
  url: z.string().nullable(),
  placeholder: z.string(),
  scale: pos,
});
export const AssetsFileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  assets: z.record(z.string(), AssetEntrySchema),
});
