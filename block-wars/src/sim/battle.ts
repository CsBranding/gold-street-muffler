/**
 * Battle simulation. Runs on a fixed timestep, owns all gameplay state and
 * reads every tunable from config. It never touches Three.js or the DOM; the
 * renderer and UI read its state and drain `events` once per frame.
 */
import type { BossAttack, EnemyDef, GameConfig, LevelDef, MapDef, Reward, Weapon } from '../schema/types';
import { crowdExtents, unitOffset, type CrowdExtents } from './formation';
import { addEnemy, compileLevel, hordeSlotOffset } from './level';
import type { Loadout } from './loadout';
import { Rng } from './rng';
import type { BannerKey, CompiledLevel, HordeRT, LaneWallRT, ObstacleRT, PickupRT, TelegraphRT } from './world';

export type SimEvent =
  | { t: 'banner'; key: BannerKey }
  | { t: 'gate'; op: string; value: number; before: number; after: number; x: number; z: number; negative: boolean }
  | { t: 'shot'; fx: number; fz: number; tx: number; ty: number; tz: number; hit: boolean; leader: boolean; cls: Weapon['class'] }
  | { t: 'hit'; x: number; y: number; z: number; dmg: number; crit: boolean; blocked: boolean }
  | { t: 'kill'; x: number; z: number; defIndex: number }
  | { t: 'crewLost'; n: number; cause: 'fire' | 'slam' | 'taser' | 'gas' | 'melee' }
  | { t: 'recruits'; n: number }
  | { t: 'obstacleDestroyed'; id: number; x: number; z: number; kind: string }
  | { t: 'reward'; reward: Reward; x: number; z: number; rarity: string }
  | { t: 'explode'; x: number; z: number; r: number }
  | { t: 'telegraph'; attackId: string }
  | { t: 'bossAttack'; attackId: string; x: number; z: number; r: number; killed: number }
  | { t: 'bossEnrage' }
  | { t: 'bossDefeated'; x: number; z: number; loot: number }
  | { t: 'leaderHit'; dmg: number }
  | { t: 'hazard'; kind: 'spotlight' | 'drive_by'; phase: 'telegraph' | 'active' | 'done' }
  | { t: 'won' }
  | { t: 'failed' };

export type Phase = 'run' | 'blocked' | 'hold' | 'push' | 'boss' | 'done';
/** All-Out: which side the crew prioritizes */
export type Focus = 'nearest' | 'police' | 'rival';

export interface BattleStats {
  kills: number;
  cash: number;
  shards: Record<string, number>;
  revives: number;
  peakCrew: number;
  gatesHit: number;
  timeSec: number;
  obstaclesDestroyed: number;
}

const DEG = Math.PI / 180;
const K_OBSTACLE = 0;
const K_ENEMY = 1;
const K_BOSS = 2;

export class Battle {
  readonly cfg: GameConfig;
  readonly level: CompiledLevel;
  readonly levelDef: LevelDef;
  readonly map: MapDef;
  readonly loadout: Loadout;
  readonly rng: Rng;
  readonly dt: number;

  status: 'running' | 'won' | 'failed' = 'running';
  phase: Phase = 'run';
  time = 0;
  events: SimEvent[] = [];
  stats: BattleStats = { kills: 0, cash: 0, shards: {}, revives: 0, peakCrew: 0, gatesHit: 0, timeSec: 0, obstaclesDestroyed: 0 };

  crowd = { x: 0, z: 0, prevZ: 0, targetX: 0, followers: 0, leaderHp: 0, leaderMaxHp: 0, damagePool: 0, invuln: 0, steerSlow: 1 };
  ext: CrowdExtents;
  squad = { weapon: null as unknown as Weapon, level: 1, magMult: 1, acc: 0, climb: 0 };
  leader = { weapon: null as unknown as Weapon, ammo: 0, reloadT: 0, cooldown: 0, climb: 0 };
  buffs = { lowrider: 0, dirtBike: 0, armor: false };
  pickups: PickupRT[] = [];
  laneLock: { wall: LaneWallRT; lane: number } | null = null;
  focus: Focus = 'nearest';
  /** crew damage multiplier this tick (helicopter spotlight) */
  private exposure = 1;

  private weapons: Map<string, Weapon>;
  private enemyDefs: EnemyDef[];
  private pickupId = 0;
  private holdShown = new Set<number>();
  private pushShown = new Set<number>();
  private compact = new Set<number>();
  private tmp = { x: 0, z: 0 };
  // target candidate scratch
  private cKind: Int8Array;
  private cIdx: Int32Array;
  private cX: Float32Array;
  private cZ: Float32Array;
  private cScore: Float32Array;
  private cDist: Float32Array;
  private nCand = 0;
  private tracersThisTick = 0;
  private hitsThisTick = 0;

  constructor(cfg: GameConfig, map: MapDef, levelDef: LevelDef, loadout: Loadout, seed = cfg.game.sim.seed) {
    this.cfg = cfg;
    this.map = map;
    this.levelDef = levelDef;
    this.loadout = loadout;
    this.rng = new Rng(seed);
    this.dt = 1 / cfg.game.sim.tickHz;
    this.level = compileLevel(cfg, map, levelDef, loadout.mode);
    this.enemyDefs = this.level.enemyDefs;
    this.weapons = new Map(cfg.weapons.weapons.map((w) => [w.id, w]));
    this.squad.weapon = this.weapons.get(cfg.game.crowd.squadStartWeaponId)!;
    this.leader.weapon = this.weapons.get(loadout.leaderWeaponId)!;
    this.leader.ammo = this.leader.weapon.mag;
    this.crowd.followers = Math.min(cfg.game.crowd.maxCrew - 1, Math.max(0, Math.round(loadout.startCrew)));
    this.crowd.leaderHp = this.crowd.leaderMaxHp = loadout.leaderHp;
    const n = cfg.game.sim.targetCandidates;
    this.cKind = new Int8Array(n);
    this.cIdx = new Int32Array(n);
    this.cX = new Float32Array(n);
    this.cZ = new Float32Array(n);
    this.cScore = new Float32Array(n);
    this.cDist = new Float32Array(n);
    this.ext = this.extents();
    this.stats.peakCrew = this.crewCount;
  }

  /** Displayed crew count: followers + the leader. */
  get crewCount(): number {
    return this.crowd.followers + (this.crowd.leaderHp > 0 ? 1 : 0);
  }
  get front(): number {
    return this.crowd.z + this.ext.front;
  }
  get activeHorde(): HordeRT | null {
    for (const h of this.level.hordes) if (h.state !== 'dead' && h.state !== 'idle') return h;
    return null;
  }

  setSteerTarget(x: number): void {
    const half = this.cfg.game.road.width / 2;
    this.crowd.targetX = Math.max(-half, Math.min(half, x));
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ step
  step(): void {
    const dt = this.dt;
    const boss = this.level.boss;
    if (this.status !== 'running') {
      if (boss && boss.state === 'dead') boss.deadT += dt;
      return;
    }
    this.time += dt;
    this.stats.timeSec = this.time;
    this.tracersThisTick = 0;
    this.hitsThisTick = 0;
    this.buffs.lowrider = Math.max(0, this.buffs.lowrider - dt);
    this.buffs.dirtBike = Math.max(0, this.buffs.dirtBike - dt);
    this.crowd.invuln = Math.max(0, this.crowd.invuln - dt);
    this.ext = this.extents();

    this.steer(dt);
    this.move(dt);
    this.updateGates();
    this.updatePickups(dt);
    this.gatherTargets();
    this.fireSquad(dt);
    this.fireLeader(dt);
    let dmgIn = this.updateHazards(dt);
    dmgIn += this.enemyAttacks(dt);
    if (boss) dmgIn += this.updateBoss(dt);
    dmgIn *= this.exposure;
    this.applyCrewDamage(dmgIn, 'fire');
    this.compactHordes();
    this.updateBanners();
    this.checkEnd();
    this.stats.peakCrew = Math.max(this.stats.peakCrew, this.crewCount);
  }

  private extents(): CrowdExtents {
    const c = this.cfg.game.crowd;
    return crowdExtents(this.crewCount, c.spacing, c.maxHalfWidth);
  }

  // -------------------------------------------------------------- movement
  private steer(dt: number): void {
    const c = this.cfg.game.crowd;
    const half = this.cfg.game.road.width / 2;
    const s = c.steerSpeed * this.crowd.steerSlow * dt;
    this.crowd.steerSlow = 1;
    const dx = this.crowd.targetX - this.crowd.x;
    this.crowd.x += Math.max(-s, Math.min(s, dx));
    const margin = Math.min(this.ext.halfWidth * 0.6, half - 0.4);
    let lo = -half + margin;
    let hi = half - margin;

    // Lane walls: once the leader is past the barricade line the lane is locked.
    if (this.laneLock && this.crowd.z > this.laneLock.wall.z1) this.laneLock = null;
    if (!this.laneLock) {
      for (const w of this.level.walls) {
        if (this.crowd.z >= w.z0 && this.crowd.z <= w.z1) {
          this.laneLock = { wall: w, lane: this.laneOf(w, this.crowd.x) };
          break;
        }
      }
    }
    if (this.laneLock) {
      const { wall, lane } = this.laneLock;
      const lw = wall.edges[lane + 1] - wall.edges[lane];
      const m = Math.min(margin, lw / 2 - 0.3);
      lo = wall.edges[lane] + m;
      hi = wall.edges[lane + 1] - m;
    }
    this.crowd.x = Math.max(lo, Math.min(hi, this.crowd.x));
  }

  laneOf(w: LaneWallRT, x: number): number {
    for (let i = 0; i < w.edges.length - 2; i++) if (x < w.edges[i + 1]) return i;
    return w.edges.length - 2;
  }

  /** Obstacles inside a lane segment only interact with the crew's own lane. */
  private obstacleReachable(o: ObstacleRT): boolean {
    for (const w of this.level.walls) {
      if (o.z >= w.z0 && o.z <= w.z1) {
        if (o.kind === 'barricade' && !this.laneLock) return true;
        const lane = this.laneLock && this.laneLock.wall === w ? this.laneLock.lane : this.laneOf(w, this.crowd.x);
        return this.laneOf(w, o.x) === lane;
      }
    }
    return true;
  }

  private move(dt: number): void {
    const g = this.cfg.game;
    const c = g.crowd;
    const front = this.front;
    let maxFront = Infinity;
    let blocked = false;

    for (const o of this.level.obstacles) {
      if (!o.alive) continue;
      const face = o.z - o.halfD;
      if (face < front - 0.6 || face > front + 3) continue;
      if (Math.abs(o.x - this.crowd.x) > o.halfW + this.ext.halfWidth * 0.6) continue;
      if (!this.obstacleReachable(o)) continue;
      if (face < maxFront) maxFront = face;
    }
    if (maxFront <= front + 0.02) blocked = true;

    // Hordes
    let engaged: HordeRT | null = null;
    for (const h of this.level.hordes) {
      if (h.state === 'dead') continue;
      const dist = h.anchorZ - front;
      if (h.state === 'idle' && dist <= g.horde.aggroRange) h.state = 'advancing';
      if (h.state === 'idle') continue;
      if (h.rooftop) {
        // ledge shooters never block the road; once passed they're out of the fight
        if (h.anchorZ < this.crowd.z - this.ext.back - 3) this.retireHorde(h);
        continue;
      }
      // hold where the squad weapon can actually reach (shotguns step in closer)
      if (dist <= Math.min(c.engageRange, this.squad.weapon.rangeM - 1)) {
        h.engaged = true;
        engaged = engaged ?? h;
      }
      h.slowTimer = Math.max(0, h.slowTimer - dt);
      if (h.slowTimer === 0) h.slowMult = 1;
      if (h.state === 'advancing') {
        const stopAt = front + c.contactGap;
        h.anchorZ = Math.max(stopAt, h.anchorZ - h.speed * h.slowMult * dt);
        if (h.anchorZ <= stopAt + 0.01) h.state = 'contact';
      } else if (h.state === 'contact' && h.anchorZ - front > c.contactGap + 0.3) {
        h.state = 'advancing';
      }
      this.layoutHorde(h);
    }

    const speedMult = this.buffs.dirtBike > 0 ? g.pickups.dirtBike.speedMult : this.buffs.lowrider > 0 ? g.pickups.lowrider.speedMult : 1;
    let speed = c.runSpeed * speedMult;
    let phase: Phase = 'run';
    if (engaged) {
      engaged.pushing = engaged.alive < this.crewCount * g.horde.pushThreshold;
      if (engaged.pushing) {
        speed = c.chargeSpeed * speedMult;
        maxFront = Math.min(maxFront, engaged.anchorZ - c.contactGap);
        phase = 'push';
      } else {
        speed = 0;
        phase = 'hold';
      }
    }
    const boss = this.level.boss;
    if (boss && boss.state !== 'dead' && this.crowd.z >= boss.segZ - this.ext.front) {
      maxFront = Math.min(maxFront, boss.z - boss.def.standoffM);
      phase = 'boss';
    }
    if (blocked && phase === 'run') phase = 'blocked';
    this.phase = phase;

    this.crowd.prevZ = this.crowd.z;
    const newFront = Math.min(front + speed * dt, Math.max(front, maxFront));
    this.crowd.z += newFront - front;
  }

  private retireHorde(h: HordeRT): void {
    const e = this.level.enemies;
    for (const idx of h.units) e.alive[idx] = 0;
    h.alive = 0;
    h.hp = 0;
    h.state = 'dead';
    h.engaged = false;
  }

  private layoutHorde(h: HordeRT): void {
    const e = this.level.enemies;
    const sp = this.cfg.game.horde.spacing;
    for (const idx of h.units) {
      if (!e.alive[idx]) continue;
      hordeSlotOffset(e.slot[idx], h.columns, sp, this.tmp);
      e.x[idx] = h.x + this.tmp.x;
      e.z[idx] = h.anchorZ + this.tmp.z;
    }
  }

  // ----------------------------------------------------------------- gates
  private updateGates(): void {
    const z0 = this.crowd.prevZ;
    const z1 = this.crowd.z;
    if (z1 <= z0) return;
    for (const gt of this.level.gates) {
      if (gt.consumed || gt.z <= z0 || gt.z > z1) continue;
      if (this.crowd.x < gt.x0 || this.crowd.x >= gt.x1) {
        // A lane gate outside our lane stays for nobody; a row gate is consumed with its row.
        continue;
      }
      for (const other of this.level.gates) if (other.rowId === gt.rowId) other.consumed = true;
      const before = this.crewCount;
      let after = before;
      if (gt.op === 'add') after = before + gt.value;
      else if (gt.op === 'sub') after = before - gt.value;
      else if (gt.op === 'mul') after = before * gt.value;
      else after = Math.floor(before / gt.value);
      this.setCrew(after);
      this.stats.gatesHit++;
      this.events.push({ t: 'gate', op: gt.op, value: gt.value, before, after: this.crewCount, x: this.crowd.x, z: gt.z, negative: gt.negative });
    }
  }

  /** Set the displayed crew count; gates never kill the leader. */
  private setCrew(count: number): void {
    const max = this.cfg.game.crowd.maxCrew - 1;
    const before = this.crowd.followers;
    this.crowd.followers = Math.max(0, Math.min(max, Math.round(count) - 1));
    const gained = this.crowd.followers - before;
    if (gained > 0) this.events.push({ t: 'recruits', n: gained });
    else if (gained < 0) this.events.push({ t: 'crewLost', n: -gained, cause: 'fire' });
    this.ext = this.extents();
  }

  // --------------------------------------------------------------- pickups
  private updatePickups(dt: number): void {
    const g = this.cfg.game;
    for (const h of this.level.hordes) {
      if (h.engaged && !h.pickupsReleased) {
        h.pickupsReleased = true;
        for (const p of h.pickups)
          this.pickups.push({ id: this.pickupId++, x: p.x, z: Math.min(h.anchorZ - 2, this.front + 4 + p.at * 0.3), reward: p.reward, rarity: p.rarity, alive: true });
      }
    }
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.z -= g.horde.pickupDriftSpeed * dt;
      if (p.z <= this.front && Math.abs(p.x - this.crowd.x) < this.ext.halfWidth + 0.6) {
        p.alive = false;
        this.grantReward(p.reward, p.x, p.z, p.rarity);
      } else if (p.z < this.crowd.z - this.ext.back - 2) p.alive = false;
    }
  }

  private grantReward(r: Reward, x: number, z: number, rarity: string): void {
    const g = this.cfg.game;
    const loot = this.loadout.lootMult;
    switch (r.kind) {
      case 'weapon':
        this.squad.weapon = this.weapons.get(r.weaponId)!;
        this.squad.acc = 0;
        break;
      case 'weapon_level':
        this.squad.level = Math.min(5, this.squad.level + r.levels);
        break;
      case 'recruits':
        this.setCrew(this.crewCount + Math.round(r.count * loot));
        break;
      case 'leader_shard':
        this.stats.shards[r.leaderId] = (this.stats.shards[r.leaderId] ?? 0) + r.count;
        break;
      case 'vehicle':
        if (r.vehicle === 'lowrider') this.buffs.lowrider = g.pickups.lowrider.durationSec;
        else {
          this.buffs.dirtBike = g.pickups.dirtBike.durationSec;
          if (g.pickups.dirtBike.invulnerable) this.crowd.invuln = Math.max(this.crowd.invuln, g.pickups.dirtBike.durationSec);
        }
        break;
      case 'drum_mag':
        this.squad.magMult = g.pickups.drumMagMult;
        break;
      case 'armor_vest':
        this.buffs.armor = true;
        break;
      case 'cash':
        this.stats.cash += r.amount * loot * g.pickups.rarityLootMult[rarity as 'common'];
        break;
    }
    this.events.push({ t: 'reward', reward: r, x, z, rarity });
  }

  // ------------------------------------------------------------- targeting
  private pushCandidate(kind: number, idx: number, x: number, z: number, dist: number, score: number): void {
    const n = this.cScore.length;
    let i = this.nCand;
    if (i === n) {
      if (score >= this.cScore[n - 1]) return;
      i = n - 1;
    } else this.nCand++;
    while (i > 0 && this.cScore[i - 1] > score) {
      this.cKind[i] = this.cKind[i - 1];
      this.cIdx[i] = this.cIdx[i - 1];
      this.cX[i] = this.cX[i - 1];
      this.cZ[i] = this.cZ[i - 1];
      this.cScore[i] = this.cScore[i - 1];
      this.cDist[i] = this.cDist[i - 1];
      i--;
    }
    this.cKind[i] = kind;
    this.cIdx[i] = idx;
    this.cX[i] = x;
    this.cZ[i] = z;
    this.cScore[i] = score;
    this.cDist[i] = dist;
  }

  private gatherTargets(): void {
    const c = this.cfg.game.crowd;
    this.nCand = 0;
    const range = Math.max(this.squad.weapon.rangeM, this.leader.weapon.rangeM);
    const ox = this.crowd.x;
    const oz = this.front;
    const hw = this.ext.halfWidth;
    const tanCone = Math.tan(c.targetConeDeg * DEG);
    const focusSide = this.loadout.mode === 'all_out' && this.focus !== 'nearest' ? this.focus : null;
    const consider = (kind: number, idx: number, x: number, z: number, halfW: number, penalty = 0) => {
      const dz = z - oz;
      if (dz < -1.5) return;
      const dx = x - ox;
      const dist = Math.hypot(dx, dz);
      if (dist > range) return;
      const lat = Math.max(0, Math.abs(dx) - halfW - hw);
      if (lat > Math.max(0, dz) * tanCone + 1) return;
      this.pushCandidate(kind, idx, x, z, dist, dist + lat * c.lateralTargetPenalty + penalty);
    };
    for (const o of this.level.obstacles) if (o.alive && this.obstacleReachable(o)) consider(K_OBSTACLE, o.id, o.x, o.z - o.halfD, o.halfW);
    const e = this.level.enemies;
    for (const h of this.level.hordes) {
      if (h.state === 'idle' || h.state === 'dead') continue;
      for (const idx of h.units) {
        if (!e.alive[idx]) continue;
        const pen = focusSide && this.enemyDefs[e.defIndex[idx]].side !== focusSide ? this.cfg.game.allOut.focusPenalty : 0;
        consider(K_ENEMY, idx, e.x[idx], e.z[idx], 0.3, pen);
      }
    }
    const b = this.level.boss;
    if (b && b.state === 'fighting') consider(K_BOSS, 0, b.x, b.z - 1.5, 1.5);
  }

  private pickCandidate(): number {
    const r = this.rng.next();
    return Math.min(this.nCand - 1, Math.floor(r * r * this.nCand));
  }

  // ---------------------------------------------------------------- firing
  private fireSquad(dt: number): void {
    const f = this.crowd.followers;
    const w = this.squad.weapon;
    const wc = this.cfg.weapons;
    if (this.nCand === 0 || f === 0) {
      this.squad.acc = 0;
      this.squad.climb = 0;
      return;
    }
    const lvl = this.squad.level - 1;
    const rate = w.ratePerSec * wc.levelRateMult[lvl] * this.loadout.fireRateMult;
    const magTime = (w.mag * this.squad.magMult) / rate;
    const sustain = magTime / (magTime + w.reloadSec);
    const total = f * rate * w.pellets * sustain * dt + this.squad.acc;
    let n = Math.floor(total);
    this.squad.acc = total - n;
    if (n === 0) return;
    let scale = 1;
    const max = this.cfg.game.sim.maxShotsPerTick;
    if (n > max) {
      scale = n / max;
      n = max;
    }
    this.squad.climb = Math.min(wc.maxMuzzleClimb, this.squad.climb + w.muzzleClimb * rate * dt);
    const lowrider = this.buffs.lowrider > 0 ? this.cfg.game.pickups.lowrider.damageMult : 1;
    const dmg = w.damage * wc.levelDamageMult[lvl] * this.loadout.crewDamageMult * lowrider * scale;
    const spread = wc.spreadValues[w.spread] + this.squad.climb;
    const traceEvery = Math.max(1, Math.ceil(n / 6));
    for (let s = 0; s < n; s++) {
      const unit = 1 + this.rng.int(f);
      unitOffset(unit, this.ext, this.cfg.game.crowd.spacing, this.tmp);
      const sx = this.crowd.x + this.tmp.x;
      const sz = this.crowd.z + this.tmp.z;
      this.shoot(w, dmg, spread, sx, sz, this.pickCandidate(), s % traceEvery === 0, false);
    }
  }

  private fireLeader(dt: number): void {
    const L = this.leader;
    const w = L.weapon;
    if (this.crowd.leaderHp <= 0) return;
    L.cooldown = Math.max(0, L.cooldown - dt);
    if (L.reloadT > 0) {
      L.reloadT -= dt;
      if (L.reloadT <= 0) L.ammo = w.mag;
      return;
    }
    if (this.nCand === 0) {
      L.climb = 0;
      return;
    }
    const wc = this.cfg.weapons;
    while (L.cooldown <= 0 && L.ammo > 0) {
      L.climb = Math.min(wc.maxMuzzleClimb, L.climb + w.muzzleClimb);
      const dmg = w.damage * this.loadout.crewDamageMult;
      for (let p = 0; p < w.pellets; p++) this.shoot(w, dmg, wc.spreadValues[w.spread] + L.climb, this.crowd.x, this.crowd.z, 0, p === 0, true);
      L.ammo--;
      L.cooldown += 1 / (w.ratePerSec * this.loadout.fireRateMult);
      if (L.ammo === 0) {
        L.reloadT = w.reloadSec;
        break;
      }
    }
  }

  private shoot(w: Weapon, dmg: number, spread: number, sx: number, sz: number, ci: number, trace: boolean, leader: boolean): void {
    if (ci >= this.nCand) return;
    const dist = this.cDist[ci];
    const hit = this.rng.chance(1 / (1 + spread * dist));
    if (trace && this.tracersThisTick < 14) {
      this.tracersThisTick++;
      const miss = hit ? 0 : this.rng.range(-0.8, 0.8);
      this.events.push({ t: 'shot', fx: sx, fz: sz, tx: this.cX[ci] + miss, ty: this.cKind[ci] === K_BOSS ? 4 : 0.7, tz: this.cZ[ci], hit, leader, cls: w.class });
    }
    if (!hit) return;
    const wc = this.cfg.weapons;
    const crit = this.rng.chance(wc.baseCritChance + w.critBonus);
    const d = crit ? dmg * wc.critMultiplier : dmg;
    for (let p = 0; p <= w.pierce && ci + p < this.nCand; p++) {
      const k = ci + p;
      if (this.cKind[k] === K_ENEMY && !this.level.enemies.alive[this.cIdx[k]]) continue;
      this.damageTarget(this.cKind[k], this.cIdx[k], d, crit, sx, sz, w, leader || (trace && p === 0));
    }
  }

  private emitHit(x: number, y: number, z: number, dmg: number, crit: boolean, blocked: boolean, show: boolean): void {
    if (!show || this.hitsThisTick >= 8) return;
    this.hitsThisTick++;
    this.events.push({ t: 'hit', x, y, z, dmg, crit, blocked });
  }

  private damageTarget(kind: number, idx: number, dmg: number, crit: boolean, sx: number, sz: number, w: Weapon | null, show: boolean): void {
    if (kind === K_OBSTACLE) {
      const o = this.level.obstacles[idx];
      if (!o.alive) return;
      o.hp -= dmg;
      this.emitHit(o.x, 0.9, o.z - o.halfD, dmg, crit, false, show);
      if (o.hp <= 0) this.destroyObstacle(o);
    } else if (kind === K_ENEMY) {
      this.damageEnemy(idx, dmg, crit, sx, sz, w, show);
    } else {
      const b = this.level.boss!;
      if (b.state !== 'fighting') return;
      if (b.shieldTimer > 0 && Math.abs(this.crowd.x - b.x) < b.def.flankOffsetM) {
        this.emitHit(b.x, 2, b.z - 2, 0, false, true, show);
        return;
      }
      const wp = b.def.weakPoint;
      const head = (!wp.onlyWhenShieldDown || b.shieldTimer <= 0) && this.rng.chance(wp.chance);
      const d = head ? dmg * wp.mult : dmg;
      b.hp -= d;
      this.emitHit(b.x + this.rng.range(-1, 1), head ? 7 : 3.5, b.z - 1, d, crit || head, false, show);
      if (b.hp <= 0) this.killBoss();
    }
  }

  private damageEnemy(idx: number, dmg: number, crit: boolean, sx: number, sz: number, w: Weapon | null, show: boolean, credit = true): void {
    const e = this.level.enemies;
    if (!e.alive[idx]) return;
    const def = this.enemyDefs[e.defIndex[idx]];
    const h = this.level.hordes[e.horde[idx]];
    const x = e.x[idx];
    const z = e.z[idx];
    if (e.shield[idx] > 0) {
      const ang = Math.atan2(Math.abs(sx - x), z - sz) / DEG;
      if (ang < def.shieldArcDeg) {
        const absorbed = Math.min(e.shield[idx], dmg);
        e.shield[idx] -= absorbed;
        h.hp -= absorbed;
        this.emitHit(x, 0.8, z, absorbed, false, true, show);
        return;
      }
    }
    const d = Math.min(e.hp[idx], dmg * def.armorMult);
    e.hp[idx] -= d;
    h.hp -= d;
    this.emitHit(x, 1.2, z, d, crit, false, show);
    if (w) {
      if (w.knockback > 0) h.anchorZ = Math.min(h.anchorZ + w.knockback * 0.004, this.front + this.cfg.game.crowd.engageRange);
      if (w.slowMult < 1) {
        h.slowMult = w.slowMult;
        h.slowTimer = 0.3;
      }
    }
    if (e.hp[idx] <= 0.001) this.killEnemy(idx, credit);
  }

  private killEnemy(idx: number, credit = true): void {
    const e = this.level.enemies;
    e.alive[idx] = 0;
    const h = this.level.hordes[e.horde[idx]];
    const def = this.enemyDefs[e.defIndex[idx]];
    h.hp -= e.shield[idx] + Math.max(0, e.hp[idx]);
    h.alive--;
    if (credit) {
      this.stats.kills++;
      this.stats.cash += def.cash;
    }
    this.compact.add(h.id);
    this.events.push({ t: 'kill', x: e.x[idx], z: e.z[idx], defIndex: e.defIndex[idx] });
    if (h.alive <= 0) {
      h.state = 'dead';
      h.hp = 0;
      h.engaged = false;
    }
  }

  private destroyObstacle(o: ObstacleRT): void {
    o.alive = false;
    o.hp = 0;
    this.stats.obstaclesDestroyed++;
    this.events.push({ t: 'obstacleDestroyed', id: o.id, x: o.x, z: o.z, kind: o.kind });
    if (o.reward) this.grantReward(o.reward, o.x, o.z, o.rarity);
    if (o.explodeDamage > 0) {
      this.events.push({ t: 'explode', x: o.x, z: o.z, r: o.explodeRadius });
      const e = this.level.enemies;
      const r2 = o.explodeRadius * o.explodeRadius;
      for (let i = 0; i < e.count; i++) {
        if (!e.alive[i]) continue;
        const dx = e.x[i] - o.x;
        const dz = e.z[i] - o.z;
        if (dx * dx + dz * dz < r2) this.damageEnemy(i, o.explodeDamage, false, o.x, o.z - 100, null, false);
      }
      const b = this.level.boss;
      if (b && b.state === 'fighting' && Math.hypot(b.x - o.x, b.z - o.z) < o.explodeRadius + 2) {
        b.hp -= o.explodeDamage;
        if (b.hp <= 0) this.killBoss();
      }
    }
  }

  // --------------------------------------------------------- enemy attacks
  private enemyAttacks(dt: number): number {
    const e = this.level.enemies;
    const c = this.cfg.game.crowd;
    const fx = this.crowd.x;
    const fz = this.front;
    let dmg = 0;
    const tier = this.cfg.weapons.levelDamageMult[this.squad.level - 1];
    const allOut = this.loadout.mode === 'all_out';
    const ao = this.cfg.game.allOut;
    const boss = this.level.boss;
    for (const h of this.level.hordes) {
      if (h.state === 'idle' || h.state === 'dead') continue;
      // All-Out: police and rival units sharing a horde trade fire with each other
      let split = 1;
      if (allOut) {
        let pol = 0;
        let riv = 0;
        for (const idx of h.units) {
          if (!e.alive[idx]) continue;
          const d = this.enemyDefs[e.defIndex[idx]];
          if (d.side === 'police') pol += d.dps + d.meleeDps;
          else riv += d.dps + d.meleeDps;
        }
        if (pol > 0 && riv > 0) {
          split = 1 - ao.infightMult;
          this.infight(h, 'rival', pol * ao.infightMult * dt);
          this.infight(h, 'police', riv * ao.infightMult * dt);
        }
        // rival raiders also go after Big Sarge
        if (riv > 0 && boss && boss.state === 'fighting' && Math.abs(h.anchorZ - boss.z) < 14) {
          boss.hp -= riv * ao.bossDamageMult * dt;
          if (boss.hp <= 0) this.killBoss();
        }
      }
      const contact = h.state === 'contact';
      const frontage = Math.max(1, Math.min(h.columns, Math.ceil((this.ext.halfWidth * 2) / this.cfg.game.horde.spacing)));
      for (const idx of h.units) {
        if (!e.alive[idx]) continue;
        const def = this.enemyDefs[e.defIndex[idx]];
        if (def.dps > 0) {
          const dx = e.x[idx] - fx;
          const dz = e.z[idx] - fz;
          if (dx * dx + dz * dz <= def.rangeM * def.rangeM) dmg += def.dps * dt * split;
        }
        if (contact && e.slot[idx] < frontage) dmg += def.meleeDps * dt * split;
      }
      if (contact) {
        // Crew brawls the front row: melee scales with frontage and squad tier.
        let budget = frontage * c.meleeDps * tier * this.loadout.crewDamageMult * dt;
        for (const idx of h.units) {
          if (budget <= 0) break;
          if (!e.alive[idx] || e.slot[idx] >= frontage) continue;
          const take = Math.min(budget, e.hp[idx] + e.shield[idx]);
          budget -= take;
          const fromShield = Math.min(e.shield[idx], take);
          e.shield[idx] -= fromShield;
          h.hp -= fromShield;
          this.damageEnemy(idx, take - fromShield, false, e.x[idx], e.z[idx] - 100, null, false);
        }
      }
    }
    return dmg;
  }

  /** spend `budget` damage on the front-most living units of `side` in horde h (no player credit) */
  private infight(h: HordeRT, side: 'police' | 'rival', budget: number): void {
    const e = this.level.enemies;
    for (const idx of h.units) {
      if (budget <= 0) return;
      if (!e.alive[idx] || this.enemyDefs[e.defIndex[idx]].side !== side) continue;
      const take = Math.min(budget, e.hp[idx] + e.shield[idx]);
      budget -= take;
      const fromShield = Math.min(e.shield[idx], take);
      e.shield[idx] -= fromShield;
      h.hp -= fromShield;
      this.damageEnemy(idx, take - fromShield, false, e.x[idx], e.z[idx] - 100, null, false, false);
    }
  }

  // ---------------------------------------------------------------- hazards
  private updateHazards(dt: number): number {
    this.exposure = 1;
    let dmg = 0;
    const g = this.cfg.game;
    const half = g.road.width / 2;
    for (const hz of this.level.hazards) {
      if (hz.state === 'done') continue;
      const def = this.enemyDefs[hz.defIndex];
      const spec = def.hazard!;
      if (hz.state === 'waiting') {
        if (this.crowd.z < hz.z0) continue;
        hz.state = 'telegraph';
        hz.t = 0;
        if (hz.kind === 'drive_by') {
          // aim down the lane the crew is in, warned by headlights + horn
          const lw = g.road.width / 3;
          const lane = Math.max(0, Math.min(2, Math.floor((this.crowd.x + half) / lw)));
          hz.x0 = -half + lane * lw;
          hz.x1 = hz.x0 + lw;
          hz.x = (hz.x0 + hz.x1) / 2;
          hz.z = this.front + 45;
        } else hz.x = -half * 0.75;
        this.events.push({ t: 'hazard', kind: hz.kind, phase: 'telegraph' });
      }
      hz.t += dt;
      if (hz.state === 'telegraph') {
        if (hz.kind === 'spotlight') hz.z = this.crowd.z + 4;
        else hz.z = this.front + 45;
        if (hz.t >= spec.telegraphSec) {
          hz.state = 'active';
          hz.t = 0;
          this.events.push({ t: 'hazard', kind: hz.kind, phase: 'active' });
        }
        continue;
      }
      // active
      if (hz.kind === 'spotlight') {
        hz.x = Math.sin(hz.t * g.hazards.spotlightSweepSpeed) * half * 0.75;
        hz.z = this.crowd.z + 4;
        if (Math.abs(this.crowd.x - hz.x) < g.hazards.spotlightWidth / 2 + this.ext.halfWidth * 0.4) this.exposure = Math.max(this.exposure, spec.damageTakenMult);
        if (this.crowd.z > hz.z1 || hz.t > spec.durationSec * 3) this.finishHazard(hz);
      } else {
        hz.z -= g.hazards.driveBySpeed * dt;
        const inLane = this.crowd.x > hz.x0 - this.ext.halfWidth * 0.3 && this.crowd.x < hz.x1 + this.ext.halfWidth * 0.3;
        if (inLane && hz.z < this.front + 4 && hz.z > this.crowd.z - this.ext.back - 2) dmg += spec.dps * dt;
        if (hz.z < this.crowd.z - this.ext.back - 10) this.finishHazard(hz);
      }
    }
    return dmg;
  }

  private finishHazard(hz: CompiledLevel['hazards'][number]): void {
    hz.state = 'done';
    this.events.push({ t: 'hazard', kind: hz.kind, phase: 'done' });
  }

  private applyCrewDamage(dmg: number, cause: 'fire' | 'gas' | 'melee'): void {
    if (dmg <= 0 || this.crowd.invuln > 0) return;
    const g = this.cfg.game;
    const unitHp = g.crowd.unitHp * this.loadout.unitHpMult * (this.buffs.armor ? g.pickups.armorUnitHpMult : 1);
    this.crowd.damagePool += dmg;
    const deaths = Math.min(this.crowd.followers, Math.floor(this.crowd.damagePool / unitHp));
    if (deaths > 0) {
      this.crowd.followers -= deaths;
      this.crowd.damagePool -= deaths * unitHp;
      this.events.push({ t: 'crewLost', n: deaths, cause });
    }
    if (this.crowd.followers === 0 && this.crowd.damagePool > 0) {
      this.damageLeader(this.crowd.damagePool);
      this.crowd.damagePool = 0;
    }
  }

  private damageLeader(dmg: number): void {
    const g = this.cfg.game;
    if (this.crowd.invuln > 0) return;
    const d = dmg * (1 - this.loadout.leaderDamageReduction) * (this.buffs.armor ? 1 - g.pickups.armorLeaderReduction : 1);
    this.crowd.leaderHp = Math.max(0, this.crowd.leaderHp - d);
    this.events.push({ t: 'leaderHit', dmg: d });
  }

  private compactHordes(): void {
    if (this.compact.size === 0) return;
    const e = this.level.enemies;
    for (const id of this.compact) {
      const h = this.level.hordes[id];
      h.units = h.units.filter((i) => e.alive[i] === 1);
      h.units.forEach((idx, s) => (e.slot[idx] = s));
      this.layoutHorde(h);
    }
    this.compact.clear();
  }

  // ------------------------------------------------------------------ boss
  private updateBoss(dt: number): number {
    const b = this.level.boss!;
    if (b.state === 'dead') {
      b.deadT += dt;
      return 0;
    }
    if (b.state === 'waiting') {
      if (this.front >= b.z - b.def.standoffM - 1.5) {
        b.state = 'fighting';
        b.attackTimer = b.def.attackIntervalSec * 0.6;
        if (this.loadout.mode === 'all_out' && b.def.side === 'police') this.spawnRivalRaiders();
      }
      return 0;
    }
    let dmg = 0;
    const def = b.def;
    const speedMult = b.enraged ? def.enrage.attackSpeedMult : 1;
    for (const k in b.cooldowns) b.cooldowns[k] = Math.max(0, b.cooldowns[k] - dt * speedMult);
    b.shieldTimer = Math.max(0, b.shieldTimer - dt);
    const half = this.cfg.game.road.width / 2;
    if (b.shieldTimer <= 0 && !b.telegraph) {
      const s = def.trackSpeed * dt;
      b.x += Math.max(-s, Math.min(s, this.crowd.x - b.x));
      b.x = Math.max(-half + 1.5, Math.min(half - 1.5, b.x));
    }
    // Lingering clouds / spray zones
    for (const gas of b.gas) {
      gas.t -= dt;
      if (this.crowd.x >= gas.x0 && this.crowd.x <= gas.x1 && this.crowd.z + this.ext.front >= gas.z0 && this.crowd.z - this.ext.back <= gas.z1) {
        dmg += gas.dps * dt;
        this.crowd.steerSlow = Math.min(this.crowd.steerSlow, gas.slowMult);
      }
    }
    b.gas = b.gas.filter((g) => g.t > 0);

    if (b.telegraph) {
      b.telegraph.t += dt;
      if (b.telegraph.t >= b.telegraph.total) {
        this.resolveAttack(b.telegraph);
        b.telegraph = null;
      }
    } else {
      b.attackTimer -= dt * speedMult;
      if (b.attackTimer <= 0) {
        b.attackTimer = def.attackIntervalSec;
        const pick = this.chooseAttack();
        if (pick) this.startTelegraph(pick);
      }
    }
    if (!b.enraged && b.hp / b.maxHp < def.enrage.hpFrac) {
      b.enraged = true;
      this.events.push({ t: 'bossEnrage' });
      this.events.push({ t: 'banner', key: 'enrage' });
    }
    if (this.front > b.z - 2.5) dmg += def.contactDps * dt;
    return dmg;
  }

  private chooseAttack(): BossAttack | null {
    const b = this.level.boss!;
    const options = b.def.attacks.filter((a) => (b.cooldowns[a.id] ?? 0) <= 0 && !(a.id === 'shield_wall' && b.shieldTimer > 0) && a.id !== b.lastAttack);
    const pool = options.length ? options : b.def.attacks.filter((a) => (b.cooldowns[a.id] ?? 0) <= 0);
    const total = pool.reduce((s, a) => s + a.weight, 0);
    if (total <= 0) return null;
    let r = this.rng.next() * total;
    for (const a of pool) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return pool[pool.length - 1];
  }

  private startTelegraph(a: BossAttack): void {
    const b = this.level.boss!;
    const half = this.cfg.game.road.width / 2;
    const laneW = this.cfg.game.road.width / 3;
    const lane = Math.max(0, Math.min(2, Math.floor((this.crowd.x + half) / laneW)));
    const tg: TelegraphRT = { attack: a, t: 0, total: a.telegraphSec, shape: 'circle', x: this.crowd.x, z: this.crowd.z, r: a.radius, x0: 0, x1: 0, z0: 0, z1: 0 };
    switch (a.id) {
      case 'shield_wall':
        Object.assign(tg, { shape: 'rect', x0: b.x - b.def.flankOffsetM, x1: b.x + b.def.flankOffsetM, z0: this.front, z1: b.z - 1 });
        break;
      case 'tear_gas':
      case 'drum_spray':
        Object.assign(tg, { shape: 'rect', x0: -half + lane * laneW, x1: -half + (lane + 1) * laneW, z0: this.crowd.z - this.ext.back - 1, z1: a.id === 'drum_spray' ? b.z - 1 : this.front + 4 });
        break;
      case 'call_backup':
      case 'summon_runners':
        Object.assign(tg, { x: b.x, z: b.z - 2, r: 3 });
        break;
    }
    b.telegraph = tg;
    b.lastAttack = a.id;
    b.cooldowns[a.id] = a.cooldownSec;
    this.events.push({ t: 'telegraph', attackId: a.id });
  }

  private unitsInCircle(x: number, z: number, r: number): number {
    const sp = this.cfg.game.crowd.spacing;
    const r2 = r * r;
    let n = 0;
    for (let i = 1; i <= this.crowd.followers; i++) {
      unitOffset(i, this.ext, sp, this.tmp);
      const dx = this.crowd.x + this.tmp.x - x;
      const dz = this.crowd.z + this.tmp.z - z;
      if (dx * dx + dz * dz < r2) n++;
    }
    return n;
  }

  private resolveAttack(tg: TelegraphRT): void {
    const b = this.level.boss!;
    const a = tg.attack;
    let killed = 0;
    const leaderInside = Math.hypot(this.crowd.x - tg.x, this.crowd.z - tg.z) < tg.r;
    switch (a.id) {
      case 'baton_slam':
      case 'taser_chain': {
        if (this.crowd.invuln > 0) break;
        const inside = this.unitsInCircle(tg.x, tg.z, tg.r);
        killed = a.id === 'baton_slam' ? inside : inside > 0 ? Math.min(this.crowd.followers, Math.max(a.minUnits, Math.min(a.maxUnits, inside))) : 0;
        if (killed > 0) {
          this.crowd.followers -= killed;
          this.events.push({ t: 'crewLost', n: killed, cause: a.id === 'baton_slam' ? 'slam' : 'taser' });
        }
        if (leaderInside && a.leaderDamage > 0) this.damageLeader(a.leaderDamage);
        break;
      }
      case 'shield_wall':
        b.shieldTimer = a.durationSec;
        break;
      case 'tear_gas':
      case 'drum_spray':
        b.gas.push({ x0: tg.x0, x1: tg.x1, z0: tg.z0, z1: tg.z1, t: a.durationSec, dps: a.dps, slowMult: a.slowMult });
        break;
      case 'call_backup':
      case 'summon_runners':
        this.spawnBackup(a);
        break;
    }
    this.events.push({ t: 'bossAttack', attackId: a.id, x: tg.x, z: tg.z, r: tg.r, killed });
    this.ext = this.extents();
  }

  private spawnBackup(a: BossAttack): void {
    const b = this.level.boss!;
    const g = this.cfg.game;
    const defIdx = new Map(this.enemyDefs.map((e, i) => [e.id, i]));
    const units = a.spawn.filter((s) => this.enemyDefs[defIdx.get(s.enemyId)!].role === 'unit');
    const obstacles = a.spawn.filter((s) => this.enemyDefs[defIdx.get(s.enemyId)!].role === 'obstacle');
    const scale = this.level.difficulty;
    if (units.length) {
      const h: HordeRT = {
        id: this.level.hordes.length,
        segZ: b.z,
        anchorZ: b.z - 3,
        x: b.x * 0.5,
        columns: 8,
        units: [],
        alive: 0,
        total: 0,
        state: 'advancing',
        speed: 0,
        slowMult: 1,
        slowTimer: 0,
        engaged: true,
        pushing: false,
        hp: 0,
        maxHp: 0,
        pickups: [],
        pickupsReleased: true,
        rooftop: false,
      };
      let slot = 0;
      let speed = 0;
      for (const s of units) {
        const di = defIdx.get(s.enemyId)!;
        const def = this.enemyDefs[di];
        const count = Math.round(s.count * Math.sqrt(scale));
        for (let i = 0; i < count; i++) {
          h.units.push(addEnemy(this.level.enemies, di, def, h.id, slot++));
          h.maxHp += def.hp + def.shieldHp;
          speed += def.speed;
        }
      }
      h.alive = h.total = h.units.length;
      h.hp = h.maxHp;
      h.speed = speed / h.units.length;
      if (this.loadout.mode === 'all_out') {
        // mix the backup into a living rival raider horde so the two sides fight
        const raid = this.level.hordes.find((x) => x.state !== 'dead' && x.units.some((i) => this.level.enemies.alive[i] && this.enemyDefs[this.level.enemies.defIndex[i]].side === 'rival'));
        if (raid) {
          for (const idx of h.units) {
            this.level.enemies.horde[idx] = raid.id;
            raid.units.push(idx);
          }
          raid.alive += h.alive;
          raid.total += h.total;
          raid.hp += h.hp;
          raid.maxHp += h.maxHp;
          raid.units.forEach((idx, s2) => (this.level.enemies.slot[idx] = s2));
          this.layoutHorde(raid);
          h.units = [];
          h.alive = 0;
          h.state = 'dead';
        }
      }
      this.level.hordes.push(h);
      this.layoutHorde(h);
    }
    obstacles.forEach((s, k) => {
      const def = this.enemyDefs[defIdx.get(s.enemyId)!];
      for (let i = 0; i < s.count; i++) {
        const side = (i + k) % 2 === 0 ? -1 : 1;
        const hp = Math.round(def.hp * scale);
        this.level.obstacles.push({
          id: this.level.obstacles.length,
          kind: 'cruiser',
          x: side * (g.road.width / 2 - g.road.obstacleHalfWidth.cruiser - 0.3),
          z: b.z - b.def.standoffM * 0.45,
          halfW: g.road.obstacleHalfWidth.cruiser,
          halfD: g.road.obstacleDepth / 2,
          hp,
          maxHp: hp,
          rarity: 'common',
          reward: null,
          alive: true,
          explodeDamage: def.explodeDamage,
          explodeRadius: def.explodeRadius,
          spawned: true,
        });
      }
    });
  }

  /** All-Out: a rival crew crashes the boss fight. They hit Big Sarge and the player alike. */
  private spawnRivalRaiders(): void {
    const b = this.level.boss!;
    const n = this.cfg.game.allOut.bossRivalCount;
    const di = this.enemyDefs.findIndex((d) => d.side === 'rival' && d.role === 'unit' && d.dps > 0);
    if (di < 0 || n <= 0) return;
    const def = this.enemyDefs[di];
    // the backup cops share the horde so the two sides brawl
    const h: HordeRT = {
      id: this.level.hordes.length, segZ: b.z, anchorZ: b.z - 5, x: -Math.sign(b.x || 1) * 2, columns: 8, units: [], alive: 0, total: 0,
      state: 'advancing', speed: def.speed * 0.4, slowMult: 1, slowTimer: 0, engaged: true, pushing: false, hp: 0, maxHp: 0, pickups: [], pickupsReleased: true, rooftop: false,
    };
    for (let i = 0; i < n; i++) {
      h.units.push(addEnemy(this.level.enemies, di, def, h.id, i));
      h.maxHp += def.hp;
    }
    h.alive = h.total = n;
    h.hp = h.maxHp;
    this.level.hordes.push(h);
    this.layoutHorde(h);
  }

  private killBoss(): void {
    const b = this.level.boss!;
    if (b.state === 'dead') return;
    b.state = 'dead';
    b.hp = 0;
    b.telegraph = null;
    b.gas = [];
    this.stats.cash += b.def.cash;
    const e = this.level.enemies;
    for (let i = 0; i < e.count; i++) if (e.alive[i]) this.killEnemy(i);
    this.events.push({ t: 'bossDefeated', x: b.x, z: b.z, loot: b.def.lootBurst });
  }

  // --------------------------------------------------------------- banners
  private updateBanners(): void {
    for (const m of this.level.banners) {
      if (!m.fired && this.crowd.z >= m.z) {
        m.fired = true;
        this.events.push({ t: 'banner', key: m.key });
      }
    }
    const h = this.activeHorde;
    if (h && h.engaged) {
      if (!h.pushing && !this.holdShown.has(h.id)) {
        this.holdShown.add(h.id);
        this.events.push({ t: 'banner', key: 'hold' });
      }
      if (h.pushing && !this.pushShown.has(h.id)) {
        this.pushShown.add(h.id);
        this.events.push({ t: 'banner', key: 'push' });
      }
    }
  }

  private checkEnd(): void {
    if (this.crowd.leaderHp <= 0) {
      this.status = 'failed';
      this.phase = 'done';
      this.events.push({ t: 'banner', key: 'fail' }, { t: 'failed' });
      return;
    }
    const b = this.level.boss;
    const won = b ? b.state === 'dead' : this.crowd.z >= this.level.finishZ && !this.activeHorde;
    if (won) {
      this.status = 'won';
      this.phase = 'done';
      this.events.push({ t: 'banner', key: 'clear' }, { t: 'won' });
    }
  }

  /** Rewarded-ad revive: restore a fresh crew, shove enemies back, brief invulnerability. */
  revive(): void {
    if (this.status !== 'failed') return;
    const g = this.cfg.game;
    this.status = 'running';
    this.stats.revives++;
    this.crowd.leaderHp = this.crowd.leaderMaxHp;
    this.crowd.damagePool = 0;
    this.setCrew(this.cfg.economy.ads.reviveCrew);
    this.crowd.invuln = g.crowd.reviveInvulnSec;
    for (const h of this.level.hordes) if (h.state !== 'dead' && h.state !== 'idle') {
      h.anchorZ += g.horde.pushbackOnRevive;
      h.state = 'advancing';
      this.layoutHorde(h);
    }
    const b = this.level.boss;
    if (b) {
      b.telegraph = null;
      b.gas = [];
    }
  }
}
