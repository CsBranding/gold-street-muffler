/**
 * Renders a Battle. Reads sim state each frame (never writes it) and turns
 * drained SimEvents into effects. Crowds are InstancedMeshes; positions are
 * smoothed toward the sim's formation targets so growth, losses and horde
 * compaction animate instead of popping.
 */
import * as THREE from 'three';
import type { GameConfig, Reward, Weapon } from '../schema/types';
import type { Battle, SimEvent } from '../sim/battle';
import { fillOffsets } from '../sim/formation';
import type { GateRT, ObstacleRT, PickupRT } from '../sim/world';
import type { Overlay } from '../ui/overlay';
import { buildBossCop, buildCharacter, buildCop, crowdMaterial } from './characters';
import { Particles, Tracers } from './effects';
import { buildEnvironment, type Environment } from './environment';
import { buildProp } from './props';
import { gateLabel, gateTexture, glowTexture, rewardTexture } from './textures';

type CrowdMat = ReturnType<typeof crowdMaterial>;

export interface RenderHooks {
  onKillHaptic(): void;
}

const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FACE_BACK = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const FACE_FWD = new THREE.Quaternion();
const C_TRACER = new THREE.Color('#ffd27a');
const C_TRACER_LEADER = new THREE.Color('#fff2b0');
const C_FLASH = new THREE.Color('#ffcc55');
const C_SPARK = new THREE.Color('#ffae3a');
const C_BLOCK = new THREE.Color('#b8e1ff');
const C_SMOKE = new THREE.Color('#9aa0a8');
const C_BRASS = new THREE.Color('#d8a63a');
const C_GOLD = new THREE.Color('#ffd23a');
const C_FIRE = new THREE.Color('#ff7a1a');

export class BattleRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private cfg: GameConfig;
  private overlay: Overlay;
  private hooks: RenderHooks;
  private level = new THREE.Group();
  private env: Environment | null = null;
  private tracers: Tracers;
  private sparks: Particles;
  private smoke: Particles;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private width = 1;
  private height = 1;
  private time = 0;

  // crowd
  private crewMeshes: THREE.InstancedMesh[] = [];
  private crewMat: CrowdMat | null = null;
  private leader: THREE.Mesh | null = null;
  private leaderMat: CrowdMat | null = null;
  private leaderRing: THREE.Mesh | null = null;
  private targets = new Float32Array(0);
  private dispX = new Float32Array(0);
  private dispZ = new Float32Array(0);
  private pop = new Float32Array(0);
  private shownCount = 0;
  private crowdX = 0;
  private crowdZ = 0;
  private factionColor = '#e0202e';

  // enemies
  private enemyMeshes = new Map<number, { mesh: THREE.InstancedMesh; mat: CrowdMat; n: number }>();
  private eDispX = new Float32Array(0);
  private eDispZ = new Float32Array(0);
  private eSeen = new Uint8Array(0);

  // level objects
  private props = new Map<number, { group: THREE.Group; icon: THREE.Sprite | null; glow: THREE.Sprite | null; hitT: number }>();
  private gates = new Map<number, { mesh: THREE.Group; fade: number }>();
  private pickupSprites = new Map<number, THREE.Sprite>();
  private boss: {
    root: THREE.Group;
    body: THREE.Mesh;
    mat: CrowdMat;
    red: THREE.Mesh;
    blue: THREE.Mesh;
    shield: THREE.Mesh;
    baton: THREE.Mesh;
    scale: number;
    flash: number;
  } | null = null;
  private telegraphCircle: THREE.Mesh;
  private telegraphFill: THREE.Mesh;
  private telegraphRect: THREE.Mesh;
  private gasMeshes: THREE.Mesh[] = [];

  // camera feel
  private shake = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private bossFocus = 0;

  constructor(container: HTMLElement, cfg: GameConfig, overlay: Overlay, hooks: RenderHooks) {
    this.cfg = cfg;
    this.overlay = overlay;
    this.hooks = hooks;
    const r = cfg.game.render;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, r.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(cfg.game.camera.fov, 9 / 16, 0.5, 260);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#445566', 1.2);
    this.sun = new THREE.DirectionalLight('#ffffff', 2);
    this.sun.position.set(-6, 14, -4);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.level);
    this.tracers = new Tracers(r.maxTracers, r.tracerLife);
    this.sparks = new Particles(Math.floor(r.maxParticles * 0.5), true);
    this.smoke = new Particles(Math.floor(r.maxParticles * 0.5), false);
    this.scene.add(this.tracers.mesh, this.sparks.mesh, this.smoke.mesh);

    const tMat = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.telegraphCircle = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), tMat('#ff2222', 0.9));
    this.telegraphFill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), tMat('#ff2222', 0.35));
    this.telegraphRect = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tMat('#ff2222', 0.32));
    for (const m of [this.telegraphCircle, this.telegraphFill, this.telegraphRect]) {
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
    }
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const px = h * this.renderer.getPixelRatio() * 0.5;
    this.sparks.setScale(px);
    this.smoke.setScale(px);
  }

  // ---------------------------------------------------------------- load
  load(battle: Battle): void {
    this.unload();
    const cfg = this.cfg;
    const th = battle.map.theme;
    const faction = cfg.factions.factions.find((f) => f.id === battle.loadout.factionId)!;
    const rival = cfg.factions.factions.find((f) => f.id === faction.rivalId)!;
    this.factionColor = faction.colors.primary;
    this.overlay.setFactionColor(faction.colors.ui);
    this.scene.background = new THREE.Color(th.sky);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.hemi.color.set(th.ambient);
    this.hemi.intensity = th.ambientIntensity;
    this.sun.color.set(th.sun);
    this.sun.intensity = th.sunIntensity;

    this.env = buildEnvironment(battle.map, battle.level, cfg.game.road.width, cfg.game.road.laneWallHeight);
    this.level.add(this.env.group);

    // crew: two outfit variants from the faction roster so crowds don't look cloned
    const chars = cfg.characters.characters.filter((c) => c.factionId === faction.id);
    const leaderChar = chars.find((c) => c.id === battle.loadout.leaderId) ?? chars[0];
    const variants = [leaderChar, ...chars.filter((c) => c !== leaderChar)].slice(0, 2);
    const maxCrew = cfg.game.render.maxCrewInstances;
    this.crewMat = crowdMaterial({ instanced: true });
    this.crewMeshes = variants.map((c) => {
      const mesh = new THREE.InstancedMesh(buildCharacter(c.outfit, c.skinTone, 'crew'), this.crewMat!, Math.ceil(maxCrew / variants.length));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.level.add(mesh);
      return mesh;
    });
    this.leaderMat = crowdMaterial({ instanced: false });
    this.leader = new THREE.Mesh(buildCharacter(leaderChar.outfit, leaderChar.skinTone, 'leader'), this.leaderMat);
    this.leader.scale.setScalar(cfg.game.crowd.leaderScale);
    this.leaderRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.46, 28),
      new THREE.MeshBasicMaterial({ color: faction.colors.primary, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.leaderRing.rotation.x = -Math.PI / 2;
    this.level.add(this.leader, this.leaderRing);
    this.targets = new Float32Array(maxCrew * 2);
    this.dispX = new Float32Array(maxCrew);
    this.dispZ = new Float32Array(maxCrew);
    this.pop = new Float32Array(maxCrew).fill(1);
    this.shownCount = 0;
    this.crowdX = battle.crowd.x;
    this.crowdZ = battle.crowd.z;

    // enemies: one instanced mesh per enemy type, created up front for every unit type
    const police = cfg.factions.police.colors;
    const rivalChars = cfg.characters.characters.filter((c) => c.factionId === rival.id);
    battle.level.enemyDefs.forEach((def, di) => {
      if (def.role !== 'unit') return;
      let geo: THREE.BufferGeometry;
      if (def.side === 'police') {
        const v = def.id.includes('riot') ? 'riot' : def.id.includes('swat') ? 'swat' : def.id.includes('motor') ? 'motor' : 'patrol';
        geo = buildCop(police, v);
      } else {
        const rc = rivalChars[Math.min(rivalChars.length - 1, ['rival_shooter', 'rival_enforcer', 'rival_runner', 'rooftop_shooter'].indexOf(def.id))] ?? rivalChars[0];
        geo = buildCharacter(rc.outfit, rc.skinTone, 'crew');
      }
      const mat = crowdMaterial({ instanced: true });
      const mesh = new THREE.InstancedMesh(geo, mat, cfg.game.render.maxEnemyInstances);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.level.add(mesh);
      this.enemyMeshes.set(di, { mesh, mat, n: 0 });
    });
    this.ensureEnemyArrays(battle.level.enemies.hp.length);
    this.eSeen.fill(0);

    for (const o of battle.level.obstacles) if (o.alive) this.addProp(o);
    for (const g of battle.level.gates) if (!g.consumed) this.addGate(g, faction.colors.primary);

    if (battle.level.boss) {
      const b = battle.level.boss;
      const parts = buildBossCop(police);
      const mat = crowdMaterial({ instanced: false });
      const root = new THREE.Group();
      const body = new THREE.Mesh(parts.body, mat);
      const red = new THREE.Mesh(parts.lightsRed, new THREE.MeshBasicMaterial({ color: police.lightRed }));
      const blue = new THREE.Mesh(parts.lightsBlue, new THREE.MeshBasicMaterial({ color: police.lightBlue }));
      const shield = new THREE.Mesh(parts.shield, new THREE.MeshLambertMaterial({ color: '#9fb3cc', transparent: true, opacity: 0.85 }));
      const baton = new THREE.Mesh(parts.baton, new THREE.MeshLambertMaterial({ color: '#111114' }));
      baton.position.set(-0.33, 0.42, 0.08);
      shield.visible = false;
      root.add(body, red, blue, shield, baton);
      const scale = b.def.heightMultOfCrew;
      root.scale.setScalar(scale);
      root.rotation.order = 'YXZ'; // yaw to face the crew, then pitch for wind-up / topple
      root.rotation.y = Math.PI;
      root.position.set(b.x, 0, b.z);
      this.level.add(root);
      this.boss = { root, body, mat, red, blue, shield, baton, scale, flash: 0 };
    }
    this.camPos.set(0, cfg.game.camera.height, battle.crowd.z - cfg.game.camera.back);
    this.camLook.set(0, 0, battle.crowd.z + cfg.game.camera.lookAhead);
    this.bossFocus = 0;
  }

  private ensureEnemyArrays(n: number): void {
    if (this.eDispX.length >= n) return;
    const grow = (a: Float32Array) => {
      const b = new Float32Array(n);
      b.set(a);
      return b;
    };
    this.eDispX = grow(this.eDispX);
    this.eDispZ = grow(this.eDispZ);
    const s = new Uint8Array(n);
    s.set(this.eSeen);
    this.eSeen = s;
  }

  private addProp(o: ObstacleRT): void {
    const group = buildProp(o, this.factionColor);
    let icon: THREE.Sprite | null = null;
    let glow: THREE.Sprite | null = null;
    if (o.reward) {
      const color = this.cfg.game.rarityColors[o.rarity];
      icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: rewardTexture(o.reward, color), depthWrite: false }));
      icon.scale.set(1.5, 1.5, 1);
      icon.position.set(0, 2.4, 0);
      glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(2.6, 2.6, 1);
      glow.position.set(0, 2.4, -0.05);
      group.add(glow, icon);
    }
    this.level.add(group);
    this.props.set(o.id, { group, icon, glow, hitT: 0 });
  }

  private addGate(g: GateRT, factionColor: string): void {
    const negCfg = this.cfg.game.gateColors;
    const w = g.x1 - g.x0 - 0.2;
    const label = gateLabel(g.op, g.value);
    const tex = gateTexture(label, g.negative ? negCfg.negative : factionColor, g.negative ? negCfg.negativeText : '#ffffff', g.negative ? '#000000' : '#00000088');
    const grp = new THREE.Group();
    const ph = Math.min(1.15, w * 0.42);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, ph),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    panel.position.y = ph / 2 + 0.25;
    panel.rotation.y = Math.PI; // readable from the camera behind the crew
    grp.add(panel);
    const postMat = new THREE.MeshLambertMaterial({ color: g.negative ? '#2b2d33' : '#f0f0f0' });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, ph + 0.35, 0.12), postMat);
      post.position.set((s * w) / 2, (ph + 0.35) / 2, 0);
      grp.add(post);
    }
    grp.position.set((g.x0 + g.x1) / 2, 0, g.z);
    this.level.add(grp);
    this.gates.set(g.id, { mesh: grp, fade: 1 });
  }

  unload(): void {
    this.level.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.level.clear();
    this.props.clear();
    this.gates.clear();
    this.enemyMeshes.clear();
    this.pickupSprites.clear();
    this.gasMeshes = [];
    this.crewMeshes = [];
    this.boss = null;
    this.env = null;
    this.telegraphCircle.visible = this.telegraphFill.visible = this.telegraphRect.visible = false;
    this.overlay.clear();
  }

  // -------------------------------------------------------------- events
  onEvents(battle: Battle, events: SimEvent[]): void {
    const cfg = this.cfg;
    let killHaptic = false;
    for (const e of events) {
      switch (e.t) {
        case 'shot': {
          this.tracers.spawn(e.fx, 0.65, e.fz, e.tx, e.ty, e.tz, e.leader ? C_TRACER_LEADER : C_TRACER);
          this.sparks.burst(e.fx, 0.7, e.fz + 0.25, { count: 1, color: C_FLASH, speed: 0.4, size: e.leader ? 0.6 : 0.35, life: 0.06, drag: 8 });
          if (e.leader || Math.random() < 0.3) this.smoke.burst(e.fx + 0.15, 0.7, e.fz, { count: 1, color: C_BRASS, speed: 1.6, up: 2.2, size: 0.07, life: 0.45, gravity: 9, drag: 1 });
          this.shake = Math.min(0.35, this.shake + cfg.weapons.shakeByClass[e.cls as Weapon['class']] * (e.leader ? 1 : 0.12));
          break;
        }
        case 'hit':
          this.sparks.burst(e.x, e.y, e.z, { count: e.blocked ? 4 : 3, color: e.blocked ? C_BLOCK : C_SPARK, speed: 3, up: 1.5, size: 0.18, life: 0.18, gravity: 6 });
          if (e.dmg > 0) this.accumulateDamage(e.x, e.y + 0.6, e.z, e.dmg, e.crit);
          else if (e.blocked) this.accumulateDamage(e.x, e.y + 0.6, e.z, 0, false, true);
          this.flashPropAt(battle, e.x, e.z);
          if (this.boss && battle.level.boss && Math.abs(e.z - battle.level.boss.z) < 3 && e.y > 2) this.boss.flash = 0.08;
          break;
        case 'kill':
          this.smoke.burst(e.x, 0.6, e.z, { count: 5, color: C_SMOKE, speed: 1.6, up: 1.2, size: 0.9, life: 0.5, drag: 3 });
          this.sparks.burst(e.x, 0.8, e.z, { count: 2, color: C_GOLD, speed: 1.5, up: 2, size: 0.25, life: 0.25, gravity: 5 });
          killHaptic = true;
          break;
        case 'obstacleDestroyed': {
          const p = this.props.get(e.id);
          if (p) {
            p.group.visible = false;
            this.smoke.burst(e.x, 0.8, e.z, { count: 14, color: C_SMOKE, speed: 3, up: 1.5, size: 1.1, life: 0.7 });
            this.sparks.burst(e.x, 1, e.z, { count: 14, color: new THREE.Color('#a0602e'), speed: 5, up: 4, size: 0.3, life: 0.6, gravity: 12, drag: 1 });
          }
          this.shake = Math.min(0.5, this.shake + 0.12);
          break;
        }
        case 'reward': {
          const color = new THREE.Color(cfg.game.rarityColors[e.rarity as 'common']);
          this.sparks.burst(e.x, 2.2, e.z, { count: 24, color, speed: 4, up: 3, size: 0.35, life: 0.6, gravity: 4 });
          this.overlay.spawnDamage(e.x, 2.8, e.z, rewardText(cfg, e.reward), `reward r-${e.rarity}`);
          break;
        }
        case 'explode':
          this.sparks.burst(e.x, 0.8, e.z, { count: 40, color: C_FIRE, speed: e.r * 2, up: 3, size: 0.8, life: 0.5, drag: 3 });
          this.smoke.burst(e.x, 1, e.z, { count: 24, color: new THREE.Color('#3b3b40'), speed: e.r, up: 2, size: 2, life: 1.1, drag: 2 });
          this.shake = 0.7;
          break;
        case 'gate': {
          const color = new THREE.Color(e.negative ? '#888888' : this.factionColor);
          this.sparks.burst(battle.crowd.x, 1, e.z, { count: 30, color, speed: 5, up: 3, size: 0.35, life: 0.5, gravity: 5 });
          this.overlay.spawnDamage(battle.crowd.x, 2.5, e.z, `${gateLabel(e.op, e.value)}`, e.negative ? 'gate-neg' : 'gate-pos');
          break;
        }
        case 'bossAttack':
          if (e.attackId === 'baton_slam' || e.attackId === 'taser_chain') {
            const col = e.attackId === 'taser_chain' ? new THREE.Color('#9fe3ff') : new THREE.Color('#d9d2c0');
            this.sparks.burst(e.x, 0.3, e.z, { count: 50, color: col, speed: e.r * 3, up: 2, size: 0.5, life: 0.45, drag: 3, spread: e.r * 3 });
            this.smoke.burst(e.x, 0.3, e.z, { count: 16, color: C_SMOKE, speed: e.r * 2, up: 1, size: 1.6, life: 0.7 });
            this.shake = 0.8;
            if (e.killed > 0) this.overlay.spawnDamage(e.x, 2, e.z, `-${e.killed}`, 'gate-neg');
          }
          if (e.attackId === 'call_backup' || e.attackId === 'summon_runners') this.shake = Math.max(this.shake, 0.3);
          break;
        case 'bossDefeated':
          for (let i = 0; i < 4; i++) this.sparks.burst(e.x, 3 + i, e.z, { count: 40, color: C_GOLD, speed: 9, up: 8, size: 0.5, life: 1.4, gravity: 9, drag: 0.5 });
          for (let i = 0; i < 10; i++) this.overlay.spawnDamage(e.x + (Math.random() - 0.5) * 6, 4 + Math.random() * 3, e.z - 2, '$', 'reward r-legendary');
          this.shake = 1;
          break;
        case 'leaderHit':
          this.sparks.burst(battle.crowd.x, 1, battle.crowd.z, { count: 4, color: new THREE.Color('#ff4444'), speed: 2, up: 2, size: 0.3, life: 0.3 });
          break;
        default:
          break;
      }
    }
    if (killHaptic) this.hooks.onKillHaptic();
  }

  /**
   * Hundreds of hits per second can't each get a number; sum them per ~1.5m
   * cell and flush on a short interval so numbers stay readable on a phone.
   */
  private dmgCells = new Map<string, { x: number; y: number; z: number; sum: number; crit: boolean; blocked: boolean }>();
  private dmgFlushT = 0;
  private accumulateDamage(x: number, y: number, z: number, dmg: number, crit: boolean, blocked = false): void {
    const key = `${Math.round(x / 1.5)}:${Math.round(z / 1.5)}:${y > 2.5 ? 1 : 0}`;
    const c = this.dmgCells.get(key);
    if (c) {
      c.sum += dmg;
      c.crit ||= crit;
      c.blocked &&= blocked;
    } else this.dmgCells.set(key, { x, y, z, sum: dmg, crit, blocked });
  }
  private flushDamage(dt: number): void {
    this.dmgFlushT -= dt;
    if (this.dmgFlushT > 0) return;
    this.dmgFlushT = 0.22;
    for (const c of this.dmgCells.values()) {
      if (c.sum > 0) this.overlay.spawnDamage(c.x, c.y, c.z, String(Math.round(c.sum)), c.crit ? 'crit' : '');
      else if (c.blocked) this.overlay.spawnDamage(c.x, c.y, c.z, 'BLOCK', 'blocked');
    }
    this.dmgCells.clear();
  }

  private flashPropAt(battle: Battle, x: number, z: number): void {
    for (const o of battle.level.obstacles) {
      if (!o.alive || Math.abs(o.z - o.halfD - z) > 0.6 || Math.abs(o.x - x) > o.halfW + 0.1) continue;
      const p = this.props.get(o.id);
      if (p) p.hitT = 0.1;
    }
  }

  // -------------------------------------------------------------- frame
  /** alpha: interpolation between the last two sim ticks; dt: render delta (scaled for slow-mo). */
  /** rolling CPU cost (ms) of the scene update and the GL submit, for the ?fps overlay */
  readonly stats = { updateMs: 0, renderMs: 0 };

  update(battle: Battle, alpha: number, dt: number): void {
    const t0 = performance.now();
    this.time += dt;
    const c = battle.crowd;
    const targetZ = c.prevZ + (c.z - c.prevZ) * alpha;
    this.crowdZ = targetZ;
    this.crowdX += (c.x - this.crowdX) * Math.min(1, dt * 18);
    this.env?.update(this.time, this.crowdZ);

    this.updateCrowd(battle, dt);
    this.updateEnemies(battle, dt);
    this.updateProps(battle, dt);
    this.updateGates(battle, dt);
    this.updatePickups(battle.pickups);
    this.updateBoss(battle, dt);
    this.updateCamera(battle, dt);
    this.tracers.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.updateLabels(battle);
    this.flushDamage(dt);
    this.overlay.updateDamage(dt, (x, y, z) => this.project(x, y, z));
    const t1 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const t2 = performance.now();
    this.stats.updateMs += (t1 - t0 - this.stats.updateMs) * 0.1;
    this.stats.renderMs += (t2 - t1 - this.stats.renderMs) * 0.1;
  }

  private updateCrowd(battle: Battle, dt: number): void {
    const cfg = this.cfg;
    const c = battle.crowd;
    const crowdCfg = cfg.game.crowd;
    const count = Math.min(battle.crewCount, this.dispX.length);
    fillOffsets(Math.max(1, count), crowdCfg.spacing, crowdCfg.maxHalfWidth, this.targets);
    // poofs for units that just left the formation
    if (count < this.shownCount) {
      const step = Math.max(1, Math.floor((this.shownCount - count) / 24));
      for (let i = count; i < this.shownCount; i += step)
        this.smoke.burst(this.crowdX + this.dispX[i], 0.5, this.crowdZ + this.dispZ[i], { count: 2, color: C_SMOKE, speed: 1, up: 1, size: 0.6, life: 0.4 });
    }
    for (let i = this.shownCount; i < count; i++) {
      // recruits pop in at their slot (spawned slightly inward for a burst feel)
      this.dispX[i] = this.targets[i * 2] * 0.3;
      this.dispZ[i] = this.targets[i * 2 + 1] * 0.3;
      this.pop[i] = 0;
    }
    this.shownCount = count;

    const lock = battle.laneLock;
    const lo = lock ? lock.wall.edges[lock.lane] + 0.2 : -Infinity;
    const hi = lock ? lock.wall.edges[lock.lane + 1] - 0.2 : Infinity;
    const roadHalf = cfg.game.road.width / 2 - 0.15;
    const k = Math.min(1, dt * 8);
    const running = battle.phase === 'run' || battle.phase === 'push';
    const runAmt = running ? 1 : 0.12;
    if (this.crewMat) {
      this.crewMat.userData.uniforms.uTime.value = this.time;
      const u = this.crewMat.userData.uniforms.uRun;
      u.value += (runAmt - u.value) * Math.min(1, dt * 6);
    }
    const nVar = this.crewMeshes.length;
    const counts = new Array(nVar).fill(0);
    for (let i = 1; i < count; i++) {
      this.dispX[i] += (this.targets[i * 2] - this.dispX[i]) * k;
      this.dispZ[i] += (this.targets[i * 2 + 1] - this.dispZ[i]) * k;
      if (this.pop[i] < 1) this.pop[i] = Math.min(1, this.pop[i] + dt * 5);
      let x = this.crowdX + this.dispX[i];
      const z = this.crowdZ + this.dispZ[i];
      if (lock && z > lock.wall.z0 && z < lock.wall.z1) x = Math.max(lo, Math.min(hi, x));
      x = Math.max(-roadHalf, Math.min(roadHalf, x));
      const s = this.pop[i] < 1 ? easeOutBack(this.pop[i]) : 1;
      tmpP.set(x, 0, z);
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, FACE_FWD, tmpS);
      const v = i % nVar;
      this.crewMeshes[v].setMatrixAt(counts[v]++, tmpM);
    }
    this.crewMeshes.forEach((m, v) => {
      m.count = counts[v];
      m.instanceMatrix.needsUpdate = true;
    });
    if (this.leader && this.leaderMat && this.leaderRing) {
      this.leaderMat.userData.uniforms.uTime.value = this.time;
      const u = this.leaderMat.userData.uniforms.uRun;
      u.value += (runAmt - u.value) * Math.min(1, dt * 6);
      this.leader.visible = c.leaderHp > 0;
      this.leader.position.set(this.crowdX, 0, this.crowdZ);
      const flick = c.invuln > 0 ? (Math.sin(this.time * 30) > 0 ? 1 : 0.4) : 1;
      this.leaderRing.position.set(this.crowdX, 0.02, this.crowdZ);
      (this.leaderRing.material as THREE.MeshBasicMaterial).opacity = 0.85 * flick;
      const s = 1 + Math.sin(this.time * 4) * 0.06;
      this.leaderRing.scale.setScalar(s * (battle.buffs.armor ? 1.25 : 1));
    }
  }

  private updateEnemies(battle: Battle, dt: number): void {
    const e = battle.level.enemies;
    this.ensureEnemyArrays(e.hp.length);
    for (const m of this.enemyMeshes.values()) m.n = 0;
    const k = Math.min(1, dt * 7);
    let anyAdvancing = false;
    for (const h of battle.level.hordes) if (h.state === 'advancing') anyAdvancing = true;
    const camZ = this.camera.position.z;
    for (let i = 0; i < e.count; i++) {
      if (!e.alive[i]) continue;
      if (!this.eSeen[i]) {
        this.eSeen[i] = 1;
        this.eDispX[i] = e.x[i];
        this.eDispZ[i] = e.z[i];
      }
      this.eDispX[i] += (e.x[i] - this.eDispX[i]) * k;
      this.eDispZ[i] += (e.z[i] - this.eDispZ[i]) * k;
      if (this.eDispZ[i] < camZ - 2 || this.eDispZ[i] > camZ + 150) continue;
      const m = this.enemyMeshes.get(e.defIndex[i]);
      if (!m || m.n >= m.mesh.instanceMatrix.count) continue;
      const def = battle.level.enemyDefs[e.defIndex[i]];
      tmpP.set(this.eDispX[i], 0, this.eDispZ[i]);
      tmpS.setScalar(def.scale);
      tmpM.compose(tmpP, FACE_BACK, tmpS);
      m.mesh.setMatrixAt(m.n++, tmpM);
    }
    for (const m of this.enemyMeshes.values()) {
      m.mesh.count = m.n;
      m.mesh.instanceMatrix.needsUpdate = true;
      m.mat.userData.uniforms.uTime.value = this.time;
      const u = m.mat.userData.uniforms.uRun;
      u.value += ((anyAdvancing ? 0.8 : 0.1) - u.value) * Math.min(1, dt * 5);
    }
  }

  private updateProps(battle: Battle, dt: number): void {
    for (const o of battle.level.obstacles) {
      let p = this.props.get(o.id);
      if (!p && o.alive) {
        this.addProp(o); // spawned mid-fight (Call for Backup cruisers)
        p = this.props.get(o.id)!;
      }
      if (!p || !o.alive) continue;
      p.hitT = Math.max(0, p.hitT - dt);
      const s = 1 + p.hitT * 0.8;
      p.group.scale.set(s, 1 + p.hitT * 0.4, s);
      if (p.icon) {
        p.icon.position.y = 2.4 + Math.sin(this.time * 3 + o.id) * 0.15;
        p.glow!.position.y = p.icon.position.y;
        (p.glow!.material as THREE.SpriteMaterial).opacity = 0.5 + Math.sin(this.time * 5 + o.id) * 0.2;
      }
      if (o.kind === 'cruiser') {
        const on = Math.sin(this.time * 14) > 0;
        const r = p.group.getObjectByName('lightR');
        const b = p.group.getObjectByName('lightB');
        if (r) r.visible = on;
        if (b) b.visible = !on;
      }
    }
  }

  private updateGates(battle: Battle, dt: number): void {
    for (const g of battle.level.gates) {
      const v = this.gates.get(g.id);
      if (!v || !g.consumed || v.fade <= 0) continue;
      v.fade = Math.max(0, v.fade - dt * 4);
      v.mesh.scale.set(1 + (1 - v.fade) * 0.3, v.fade, 1);
      v.mesh.visible = v.fade > 0;
    }
  }

  private updatePickups(pickups: PickupRT[]): void {
    for (const p of pickups) {
      let s = this.pickupSprites.get(p.id);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: rewardTexture(p.reward, this.cfg.game.rarityColors[p.rarity]), depthWrite: false }));
        s.scale.set(1.4, 1.4, 1);
        this.level.add(s);
        this.pickupSprites.set(p.id, s);
      }
      s.visible = p.alive;
      s.position.set(p.x, 1.2 + Math.sin(this.time * 4 + p.id) * 0.2, p.z);
    }
  }

  private updateBoss(battle: Battle, dt: number): void {
    const b = battle.level.boss;
    const v = this.boss;
    if (!b || !v) return;
    v.root.position.x += (b.x - v.root.position.x) * Math.min(1, dt * 6);
    v.root.position.z = b.z;
    v.mat.userData.uniforms.uTime.value = this.time;
    v.mat.userData.uniforms.uRun.value = 0.1;
    const strobe = b.enraged ? 22 : 7;
    const on = Math.sin(this.time * strobe) > 0;
    v.red.visible = on;
    v.blue.visible = !on;
    v.shield.visible = b.shieldTimer > 0;
    v.flash = Math.max(0, v.flash - dt);
    v.mat.emissive.setRGB(v.flash > 0 ? 0.5 : b.enraged && on ? 0.25 : 0, v.flash > 0 ? 0.5 : 0, v.flash > 0 ? 0.5 : 0);
    const tg = b.telegraph;
    // wind-up lean during telegraph, slam forward on release
    let lean = 0;
    if (tg) lean = -0.25 * Math.min(1, tg.t / tg.total);
    v.baton.rotation.x = tg ? -2.2 * Math.min(1, tg.t / tg.total) : 0;
    if (b.state === 'dead') {
      const t = Math.min(1, b.deadT / this.cfg.game.boss.slowMoSec);
      v.root.rotation.x = -t * t * (Math.PI / 2) * 0.98;
      v.root.position.y = -t * 0.2;
      v.red.visible = v.blue.visible = false;
    } else v.root.rotation.x = lean;

    // telegraph markers
    this.telegraphCircle.visible = this.telegraphFill.visible = this.telegraphRect.visible = false;
    if (tg && b.state === 'fighting') {
      const p = tg.t / tg.total;
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 20);
      if (tg.shape === 'circle') {
        this.telegraphCircle.visible = this.telegraphFill.visible = true;
        this.telegraphCircle.position.set(tg.x, 0.05, tg.z);
        this.telegraphCircle.scale.setScalar(tg.r);
        this.telegraphFill.position.set(tg.x, 0.04, tg.z);
        this.telegraphFill.scale.setScalar(Math.max(0.01, tg.r * p));
        (this.telegraphCircle.material as THREE.MeshBasicMaterial).opacity = pulse;
      } else {
        this.telegraphRect.visible = true;
        this.telegraphRect.position.set((tg.x0 + tg.x1) / 2, 0.04, (tg.z0 + tg.z1) / 2);
        this.telegraphRect.scale.set(tg.x1 - tg.x0, tg.z1 - tg.z0, 1);
        (this.telegraphRect.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.25 * p * pulse;
        (this.telegraphRect.material as THREE.MeshBasicMaterial).color.set(tg.attack.id === 'shield_wall' ? '#4aa3ff' : '#ff2222');
      }
    }
    // gas clouds
    while (this.gasMeshes.length < b.gas.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#9fb36a', transparent: true, opacity: 0.35, depthWrite: false }));
      this.level.add(m);
      this.gasMeshes.push(m);
    }
    this.gasMeshes.forEach((m, i) => {
      const g = b.gas[i];
      m.visible = !!g;
      if (!g) return;
      m.position.set((g.x0 + g.x1) / 2, 0.8, (g.z0 + g.z1) / 2);
      m.scale.set(g.x1 - g.x0, 1.6 + Math.sin(this.time * 3 + i) * 0.2, g.z1 - g.z0);
      if (Math.random() < dt * 20)
        this.smoke.burst(g.x0 + Math.random() * (g.x1 - g.x0), 0.5, g.z0 + Math.random() * (g.z1 - g.z0), { count: 1, color: new THREE.Color('#b9c98a'), speed: 0.4, up: 0.6, size: 1.6, life: 1 });
    });
  }

  private updateCamera(battle: Battle, dt: number): void {
    const cc = this.cfg.game.camera;
    const zoom = Math.min(cc.maxZoom, 1 + cc.zoomPerSqrtCrew * Math.sqrt(battle.crewCount));
    const b = battle.level.boss;
    const inBoss = !!b && (battle.phase === 'boss' || b.state === 'dead');
    this.bossFocus += ((inBoss ? 1 : 0) - this.bossFocus) * Math.min(1, dt * 2);
    let z = zoom * (1 + this.bossFocus * 0.25);
    let lookZ = this.crowdZ + cc.lookAhead * (1 + this.bossFocus * 0.4);
    let lookX = this.crowdX * 0.35;
    if (b && b.state === 'dead') {
      const t = Math.min(1, b.deadT / this.cfg.game.boss.slowMoSec);
      z = z * (1 - t) + cc.bossPushIn * t * z;
      lookZ = lookZ * (1 - t) + b.z * t;
      lookX = lookX * (1 - t) + b.x * t;
    }
    const want = tmpP.set(this.crowdX * 0.5, cc.height * z, this.crowdZ - cc.back * z);
    if (b && b.state === 'dead') want.z = want.z + (lookZ - cc.back * z * 1.2 - want.z) * Math.min(1, b.deadT / this.cfg.game.boss.slowMoSec);
    const k = cc.followLerp;
    this.camPos.lerp(want, 1 - Math.pow(1 - k, dt * 60));
    this.camLook.x += (lookX - this.camLook.x) * Math.min(1, dt * 6);
    this.camLook.z = lookZ;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * s, this.camPos.y + (Math.random() - 0.5) * s, this.camPos.z);
    this.camera.lookAt(this.camLook.x, 0, this.camLook.z);
    this.sun.position.set(this.camPos.x - 6, 14, this.crowdZ - 4);
    this.sun.target.position.set(this.crowdX, 0, this.crowdZ + 6);
  }

  project(x: number, y: number, z: number): { x: number; y: number } | null {
    tmpP.set(x, y, z).project(this.camera);
    if (tmpP.z > 1) return null;
    return { x: (tmpP.x * 0.5 + 0.5) * this.width, y: (-tmpP.y * 0.5 + 0.5) * this.height };
  }

  private updateLabels(battle: Battle): void {
    const o = this.overlay;
    o.begin();
    const crowdTop = this.project(this.crowdX, 2.3 * this.cfg.game.crowd.leaderScale, this.crowdZ);
    if (crowdTop && battle.crewCount > 0) o.label('crew', crowdTop.x, crowdTop.y, String(battle.crewCount));
    for (const h of battle.level.hordes) {
      if (h.state === 'dead' || h.alive === 0) continue;
      const depth = Math.ceil(h.alive / h.columns) * this.cfg.game.horde.spacing;
      const p = this.project(h.x, 2.2, h.anchorZ + Math.min(depth, 6));
      if (p && h.anchorZ - this.crowdZ < 70) o.label('horde', p.x, p.y, String(h.alive), h.hp / h.maxHp);
    }
    for (const ob of battle.level.obstacles) {
      if (!ob.alive || ob.z < this.crowdZ - 2 || ob.z - this.crowdZ > 55) continue;
      const p = this.project(ob.x, ob.kind === 'barricade' ? 0.75 : 1.35, ob.z - ob.halfD - 0.2);
      if (p) o.label('hp', p.x, p.y, String(Math.ceil(ob.hp)));
    }
    const b = battle.level.boss;
    if (b && b.state !== 'dead' && b.z - this.crowdZ < 80) {
      const p = this.project(b.x, b.def.heightMultOfCrew * 1.3, b.z);
      if (p) o.label('boss', p.x, p.y, `${Math.ceil(b.hp).toLocaleString()}`, b.hp / b.maxHp);
    }
    o.end();
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function rewardText(cfg: GameConfig, r: Reward): string {
  switch (r.kind) {
    case 'weapon':
      return cfg.weapons.weapons.find((w) => w.id === r.weaponId)!.displayName.toUpperCase();
    case 'weapon_level':
      return 'WEAPON UP!';
    case 'recruits':
      return `+${r.count} CREW`;
    case 'leader_shard':
      return `SHARD x${r.count}`;
    case 'vehicle':
      return r.vehicle === 'lowrider' ? 'LOWRIDER!' : 'DIRT BIKE!';
    case 'drum_mag':
      return 'DRUM MAG';
    case 'armor_vest':
      return 'ARMOR UP';
    case 'cash':
      return `+$${r.amount}`;
  }
}
