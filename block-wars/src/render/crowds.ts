/**
 * Animated character systems on top of the rig:
 *  - UnitFamily: one outfit's crowd (hi + lo LOD InstancedMeshes playing
 *    VAT clips) plus a pool of knocked-down "corpses" that play the fall
 *    clip once and sink away. No gore, just a stylized knockdown.
 *  - BlobShadows: one instanced soft-shadow decal for every unit on screen.
 *  - RiggedActor: SkinnedMesh + AnimationMixer with crossfades (leader, bosses).
 */
import * as THREE from 'three';
import { humanoidClips, type Look } from './rig';
import { bakeVat, setAnim, stylizedMaterial, vatInstanced, type StylizedUniforms, type VatAsset } from './vat';

export type CrowdClip = 'run' | 'aim' | 'shoot' | 'fall' | 'cheer';

const clips = humanoidClips();
const BAKE_LIST = [
  { clip: clips.run, fps: 30, loop: true },
  { clip: clips.aim, fps: 15, loop: true },
  { clip: clips.shoot, fps: 30, loop: true },
  { clip: clips.fall, fps: 30, loop: false },
  { clip: clips.cheer, fps: 20, loop: true },
];

const assetCache = new Map<string, VatAsset>();
/** Bakes are cached per outfit + detail for the session (~20–180 ms each). */
export function vatAsset(look: Look, detail: 'hi' | 'lo' | 'far'): VatAsset {
  const key = `${detail}:${JSON.stringify(look)}`;
  let a = assetCache.get(key);
  if (!a) {
    a = bakeVat(look, detail, BAKE_LIST);
    assetCache.set(key, a);
  }
  return a;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

type VatMesh = ReturnType<typeof vatInstanced>;

export class UnitFamily {
  readonly hi: VatMesh;
  readonly lo: VatMesh;
  readonly far: VatMesh;
  private corpses: VatMesh;
  private hiAsset: VatAsset;
  private loAsset: VatAsset;
  private farAsset: VatAsset;
  readonly uniforms: StylizedUniforms[] = [];
  private nHi = 0;
  private nLo = 0;
  private nFar = 0;
  /** runtime cap on hi-detail instances (quality tier adjusts it) */
  hiCap = Infinity;
  // corpse ring buffer
  private cBorn: Float32Array;
  private cX: Float32Array;
  private cZ: Float32Array;
  private cYaw: Float32Array;
  private cScale: Float32Array;
  private cNext = 0;
  private cLive = 0;

  constructor(parent: THREE.Object3D, look: Look, capacity: number, corpseCap: number, rim: string) {
    this.hiAsset = vatAsset(look, 'hi');
    this.loAsset = vatAsset(look, 'lo');
    this.farAsset = vatAsset(look, 'far');
    const mk = (a: VatAsset, cap: number) => {
      const mat = stylizedMaterial({ vat: a, rim, rimStrength: 0.45 });
      this.uniforms.push(mat.userData.uniforms);
      const m = vatInstanced(a, mat, cap);
      parent.add(m);
      return m;
    };
    this.hi = mk(this.hiAsset, capacity);
    this.lo = mk(this.loAsset, capacity);
    this.far = mk(this.farAsset, capacity);
    this.corpses = mk(this.loAsset, corpseCap);
    this.corpses.count = corpseCap;
    this.cBorn = new Float32Array(corpseCap).fill(-1e9);
    this.cX = new Float32Array(corpseCap);
    this.cZ = new Float32Array(corpseCap);
    this.cYaw = new Float32Array(corpseCap);
    this.cScale = new Float32Array(corpseCap);
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < corpseCap; i++) this.corpses.setMatrixAt(i, tmpM);
  }

  begin(): void {
    this.nHi = this.nLo = this.nFar = 0;
  }

  /**
   * lod: 0 hi, 1 lo, 2 far (hi falls back to lo past hiCap).
   * phase: seconds of loop offset so neighbours never move in lockstep.
   */
  add(x: number, z: number, yaw: number, scale: number, clip: CrowdClip, phase: number, lod: 0 | 1 | 2, speed = 1, y = 0): void {
    if (lod === 0 && this.nHi >= this.hiCap) lod = 1;
    const mesh = lod === 0 ? this.hi : lod === 1 ? this.lo : this.far;
    const asset = lod === 0 ? this.hiAsset : lod === 1 ? this.loAsset : this.farAsset;
    const i = lod === 0 ? this.nHi : lod === 1 ? this.nLo : this.nFar;
    if (i >= mesh.instanceMatrix.count) return;
    tmpP.set(x, y, z);
    tmpQ.setFromAxisAngle(UP, yaw);
    tmpS.setScalar(scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
    setAnim(mesh, i, asset.clips[clip], -phase, speed);
    if (lod === 0) this.nHi++;
    else if (lod === 1) this.nLo++;
    else this.nFar++;
  }

  end(): void {
    for (const [m, n] of [[this.hi, this.nHi], [this.lo, this.nLo], [this.far, this.nFar]] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.anim.needsUpdate = true;
    }
  }

  spawnCorpse(x: number, z: number, yaw: number, scale: number, now: number): void {
    const i = this.cNext;
    this.cNext = (this.cNext + 1) % this.cBorn.length;
    this.cBorn[i] = now;
    this.cX[i] = x;
    this.cZ[i] = z;
    this.cYaw[i] = yaw + (Math.random() - 0.5) * 0.8;
    this.cScale[i] = scale;
    setAnim(this.corpses, i, this.loAsset.clips.fall, now, 0.9 + Math.random() * 0.3);
    this.corpses.anim.needsUpdate = true;
    this.cLive = Math.max(this.cLive, 1);
  }

  updateCorpses(now: number, life: number): void {
    if (this.cLive === 0) return;
    let live = 0;
    for (let i = 0; i < this.cBorn.length; i++) {
      const age = now - this.cBorn[i];
      if (age < 0 || age > life) {
        if (age > life && age < life + 1) {
          tmpM.makeScale(0, 0, 0);
          this.corpses.setMatrixAt(i, tmpM);
        }
        continue;
      }
      live++;
      const sink = Math.max(0, age - life * 0.65) / (life * 0.35);
      tmpP.set(this.cX[i], -sink * 0.5 * this.cScale[i], this.cZ[i]);
      tmpQ.setFromAxisAngle(UP, this.cYaw[i]);
      tmpS.setScalar(this.cScale[i]);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.corpses.setMatrixAt(i, tmpM);
    }
    this.corpses.instanceMatrix.needsUpdate = true;
    this.cLive = live;
  }

  setTime(t: number): void {
    for (const u of this.uniforms) u.uTime.value = t;
  }
}

let blobTex: THREE.CanvasTexture | null = null;
function blobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

/** Soft contact shadows for every crowd unit in a single instanced draw. */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(capacity: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  begin(): void {
    this.n = 0;
  }
  add(x: number, z: number, r: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    tmpM.makeScale(r, 1, r);
    tmpM.setPosition(x, 0.015, z);
    this.mesh.setMatrixAt(this.n++, tmpM);
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A single skeletal character with crossfaded AnimationMixer actions. */
export class RiggedActor {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  current = '';
  constructor(readonly mesh: THREE.SkinnedMesh, clipSet: Record<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(mesh);
    for (const [name, c] of Object.entries(clipSet)) this.actions.set(name, this.mixer.clipAction(c));
  }
  /** Crossfade to `name`. once: play a single time and hold the last frame. duration: retime the clip. */
  play(name: string, fade = 0.2, opts: { once?: boolean; duration?: number; restart?: boolean } = {}): void {
    const next = this.actions.get(name);
    if (!next || (this.current === name && !opts.restart)) return;
    const prev = this.actions.get(this.current);
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!opts.once;
    next.timeScale = opts.duration ? next.getClip().duration / opts.duration : 1;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }
  /** true while a one-shot action is still playing */
  busy(): boolean {
    const a = this.actions.get(this.current);
    return !!a && a.loop === THREE.LoopOnce && a.isRunning();
  }
  update(dt: number): void {
    this.mixer.update(dt);
  }
}
