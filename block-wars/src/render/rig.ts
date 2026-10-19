/**
 * Procedural rigged humanoid. Rounded low-poly parts (capsules, spheres) are
 * rigidly skinned to a 15-bone skeleton, and every motion is a real
 * keyframed AnimationClip. The same rig drives:
 *  - the leader and bosses (SkinnedMesh + AnimationMixer, crossfaded), and
 *  - crowds (clips baked to a vertex-animation texture, see vat.ts).
 *
 * Coordinate frame: character faces +z, feet at y=0, ~1.15 units tall
 * (stylized: big head, chunky hands and shoes so outfits read when tiny).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Outfit } from '../schema/types';

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'thighR', 'shinR',
] as const;
export type BoneName = (typeof BONES)[number];

/** bind-pose joint positions (model space) and parents */
const JOINTS: Record<BoneName, { p: [number, number, number]; parent: BoneName | null }> = {
  hips: { p: [0, 0.5, 0], parent: null },
  spine: { p: [0, 0.6, 0], parent: 'hips' },
  chest: { p: [0, 0.72, 0], parent: 'spine' },
  neck: { p: [0, 0.86, 0], parent: 'chest' },
  head: { p: [0, 0.9, 0], parent: 'neck' },
  upperArmL: { p: [0.2, 0.83, 0], parent: 'chest' },
  foreArmL: { p: [0.215, 0.65, 0], parent: 'upperArmL' },
  handL: { p: [0.22, 0.49, 0], parent: 'foreArmL' },
  upperArmR: { p: [-0.2, 0.83, 0], parent: 'chest' },
  foreArmR: { p: [-0.215, 0.65, 0], parent: 'upperArmR' },
  handR: { p: [-0.22, 0.49, 0], parent: 'foreArmR' },
  thighL: { p: [0.085, 0.49, 0], parent: 'hips' },
  shinL: { p: [0.085, 0.27, 0], parent: 'thighL' },
  thighR: { p: [-0.085, 0.49, 0], parent: 'hips' },
  shinR: { p: [-0.085, 0.27, 0], parent: 'thighR' },
};

export interface Look {
  skin: string;
  hat: Outfit['hat'] | 'cop_cap' | 'riot_helmet' | 'swat_helmet' | 'moto_helmet';
  hatColor: string;
  top: Outfit['top'] | 'uniform';
  topColor: string;
  shirtColor: string;
  pantsColor: string;
  shoeColor: string;
  shoeAccent: string;
  chain: boolean;
  sunglasses: boolean;
  pocketBandana: string | null;
  badge: boolean;
  vest: boolean;
  shield: boolean;
  weapon: 'pistol' | 'rifle' | 'baton' | 'bat' | 'none';
  /** torso/limb bulk multiplier (bosses, enforcers) */
  bulk: number;
}

export function lookFromOutfit(o: Outfit, skin: string, weapon: Look['weapon'] = 'pistol'): Look {
  return {
    skin,
    hat: o.hat,
    hatColor: o.hatColor,
    top: o.top,
    topColor: o.topColor,
    shirtColor: o.shirtColor,
    pantsColor: o.pantsColor,
    shoeColor: o.shoeColor,
    shoeAccent: o.shoeAccent,
    chain: o.chain,
    sunglasses: o.sunglasses,
    pocketBandana: o.pocketBandana ? (o.hatColor.toLowerCase() === '#ffffff' ? '#e0202e' : o.hatColor) : null,
    badge: false,
    vest: false,
    shield: false,
    weapon,
    bulk: 1,
  };
}

export function copLook(colors: { primary: string; secondary: string }, variant: 'patrol' | 'riot' | 'swat' | 'motor' | 'boss'): Look {
  const navy = variant === 'swat' ? '#2a2f38' : colors.primary;
  return {
    skin: '#c68c63',
    hat: variant === 'patrol' ? 'cop_cap' : variant === 'swat' ? 'swat_helmet' : variant === 'motor' ? 'moto_helmet' : 'riot_helmet',
    hatColor: variant === 'patrol' ? colors.primary : variant === 'motor' ? '#f2f2f2' : '#151a26',
    top: 'uniform',
    topColor: navy,
    shirtColor: navy,
    pantsColor: new THREE.Color(colors.primary).multiplyScalar(0.75).getStyle(),
    shoeColor: '#0e0f12',
    shoeAccent: '#0e0f12',
    chain: false,
    sunglasses: true,
    pocketBandana: null,
    badge: true,
    vest: variant === 'swat' || variant === 'riot',
    shield: variant === 'riot',
    weapon: variant === 'riot' ? 'baton' : variant === 'boss' ? 'baton' : variant === 'swat' ? 'rifle' : 'pistol',
    bulk: variant === 'boss' ? 1.35 : variant === 'swat' ? 1.1 : 1,
  };
}

// ------------------------------------------------------------------ build
type Detail = 'hi' | 'lo' | 'far';

class PartBuilder {
  parts: THREE.BufferGeometry[] = [];
  constructor(private detail: Detail) {}
  get seg() {
    return this.detail === 'hi' ? { cap: 2, rad: 7, sph: 8 } : this.detail === 'lo' ? { cap: 1, rad: 4, sph: 4 } : { cap: 1, rad: 3, sph: 3 };
  }
  push(g: THREE.BufferGeometry, bone: BoneName, color: string | THREE.Color): void {
    // keep parts indexed: smooth normals per part, and gl_VertexID == index for VAT lookups
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    const bi = BONES.indexOf(bone);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts.push(g);
  }
  /** capsule between two points (model space) */
  limb(a: THREE.Vector3, b: THREE.Vector3, r: number, bone: BoneName, color: string, sx = 1, sz = 1): void {
    const len = Math.max(0.001, a.distanceTo(b));
    const g = new THREE.CapsuleGeometry(r, len, this.seg.cap, this.seg.rad);
    g.scale(sx, 1, sz);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(mid.x, mid.y, mid.z);
    this.push(g, bone, color);
  }
  sphere(c: [number, number, number], r: number, bone: BoneName, color: string, s: [number, number, number] = [1, 1, 1], partial?: { thetaLength: number }): void {
    const g = partial
      ? new THREE.SphereGeometry(r, this.seg.sph + 2, Math.ceil(this.seg.sph / 2) + 1, 0, Math.PI * 2, 0, partial.thetaLength)
      : new THREE.SphereGeometry(r, this.seg.sph, Math.ceil(this.seg.sph * 0.7));
    g.scale(...s);
    g.translate(...c);
    this.push(g, bone, color);
  }
  box(size: [number, number, number], c: [number, number, number], bone: BoneName, color: string, rot?: [number, number, number]): void {
    const g = new THREE.BoxGeometry(...size);
    if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
    g.translate(...c);
    this.push(g, bone, color);
  }
  cyl(rt: number, rb: number, h: number, c: [number, number, number], bone: BoneName, color: string, rot?: [number, number, number]): void {
    const g = new THREE.CylinderGeometry(rt, rb, h, this.seg.rad + 2);
    if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
    g.translate(...c);
    this.push(g, bone, color);
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k).getStyle();

export function buildHumanoidGeometry(look: Look, detail: Detail): THREE.BufferGeometry {
  const b = new PartBuilder(detail);
  const hi = detail === 'hi';
  const far = detail === 'far';
  const k = look.bulk;
  const open = look.top === 'hoodie_open' || look.top === 'flannel_open';
  const shortSleeve = look.top === 'tee' || look.top === 'jersey' || look.top === 'flannel_open';

  // legs: baggy jeans, chunky low-tops
  for (const s of [1, -1] as const) {
    const L = s > 0 ? 'L' : 'R';
    const x = 0.085 * s;
    b.limb(V(x, 0.47, 0), V(x, 0.29, 0.005), 0.072 * k, `thigh${L}` as BoneName, look.pantsColor);
    b.limb(V(x, 0.27, 0.005), V(x, 0.1, 0.01), 0.068 * k, `shin${L}` as BoneName, look.pantsColor, 1.05, 1.05);
    b.box([0.115 * k, 0.075, 0.2], [x, 0.04, 0.035], `shin${L}` as BoneName, look.shoeColor);
    if (hi) b.box([0.118 * k, 0.025, 0.205], [x, 0.012, 0.035], `shin${L}` as BoneName, look.shoeAccent === look.shoeColor ? shade(look.shoeColor, 1.6) : '#f4f4f4');
    if (hi) b.box([0.02, 0.035, 0.09], [x + 0.058 * s * k, 0.045, 0.03], `shin${L}` as BoneName, look.shoeAccent);
  }
  // hips / belt
  if (!far) b.limb(V(-0.07, 0.53, 0), V(0.07, 0.53, 0), 0.105 * k, 'hips', look.pantsColor, 1, 0.9);
  if (look.top === 'uniform') b.cyl(0.16 * k, 0.16 * k, 0.045, [0, 0.58, 0], 'hips', '#111216');
  if (look.pocketBandana) b.box([0.07, 0.14, 0.02], [0.07, 0.42, -0.1], 'hips', look.pocketBandana);
  // long tee hanging below the top
  if (look.top !== 'uniform' && !far) b.limb(V(-0.08, 0.59, 0), V(0.08, 0.59, 0), 0.115 * k, hi ? 'spine' : 'chest', look.shirtColor, 1, 0.85);

  // torso
  b.limb(V(0, 0.64, 0), V(0, 0.78, 0), 0.135 * k, 'chest', look.topColor, 1.3, 0.85);
  if (open) b.box([0.11, 0.24, 0.02], [0, 0.71, 0.112 * k], 'chest', look.shirtColor);
  if (look.top === 'flannel_open' && hi) {
    const dk = shade(look.topColor, 0.55);
    for (const y of [0.67, 0.75]) for (const s of [1, -1]) b.box([0.09, 0.018, 0.012], [0.11 * s, y, 0.108], 'chest', dk);
  }
  if (look.top === 'hoodie_open' && hi) b.sphere([0, 0.83, -0.1], 0.1, 'chest', look.topColor, [1.4, 0.6, 0.9]);
  if (look.top === 'puffer') b.limb(V(-0.12, 0.72, 0), V(0.12, 0.72, 0), 0.11 * k, 'chest', shade(look.topColor, 0.85), 1, 1.15);
  if (look.top === 'jersey' && hi) b.box([0.1, 0.1, 0.01], [0, 0.71, 0.115], 'chest', '#ffffff');
  if (look.vest) b.limb(V(0, 0.65, 0), V(0, 0.77, 0), 0.142 * k, 'chest', '#1a1d24', 1.28, 0.9);
  if (look.badge) b.box([0.05, 0.055, 0.015], [0.07 * k, 0.76, 0.12 * k], 'chest', '#ffcc33');
  if (look.chain && hi) {
    const g = new THREE.TorusGeometry(0.075, 0.009, 4, hi ? 14 : 8);
    g.rotateX(Math.PI / 2 - 0.5);
    g.translate(0, 0.79, 0.06);
    b.push(g, 'chest', '#dfe3ea');
  }

  // arms (sleeves, bare forearms, chunky hands)
  for (const s of [1, -1] as const) {
    const L = s > 0 ? 'L' : 'R';
    const sx = 0.2 * s * k;
    if (hi) b.sphere([sx, 0.81, 0], 0.07 * k, `upperArm${L}` as BoneName, look.topColor);
    b.limb(V(sx, 0.81, 0), V(0.215 * s * k, 0.66, 0), 0.055 * k, `upperArm${L}` as BoneName, look.topColor);
    b.limb(V(0.215 * s * k, 0.65, 0), V(0.22 * s * k, 0.52, 0), 0.047 * k, `foreArm${L}` as BoneName, shortSleeve ? look.skin : look.top === 'uniform' ? look.topColor : look.topColor);
    if (!far) b.sphere([0.22 * s * k, 0.47, 0.005], 0.05 * k, `hand${L}` as BoneName, look.skin, [1, 1.1, 1]);
  }

  // head
  if (hi) b.limb(V(0, 0.84, 0), V(0, 0.9, 0), 0.045, 'neck', look.skin);
  b.sphere([0, 1.0, 0.005], 0.155, 'head', look.skin, [1, 1.04, 1]);
  if (hi) {
    b.sphere([0.155, 0.99, 0], 0.03, 'head', look.skin);
    b.sphere([-0.155, 0.99, 0], 0.03, 'head', look.skin);
    b.sphere([0.052, 1.01, 0.14], 0.018, 'head', '#1a1210');
    b.sphere([-0.052, 1.01, 0.14], 0.018, 'head', '#1a1210');
    b.box([0.05, 0.012, 0.02], [0.052, 1.045, 0.142], 'head', '#1a1210');
    b.box([0.05, 0.012, 0.02], [-0.052, 1.045, 0.142], 'head', '#1a1210');
    b.box([0.06, 0.012, 0.02], [0, 0.94, 0.145], 'head', shade(look.skin, 0.6));
    b.sphere([0.16, 0.965, 0.01], 0.012, 'head', '#d8dbe2');
  }
  if (look.sunglasses) b.box([0.22, 0.05, 0.04], [0, 1.02, 0.14], 'head', '#0a0a0d');

  const hc = look.hatColor;
  switch (look.hat) {
    case 'snapback_back':
      b.sphere([0, 1.04, 0], 0.162, 'head', hc, [1, 0.9, 1], { thetaLength: Math.PI / 2 });
      b.box([0.17, 0.018, 0.13], [0, 1.045, -0.2], 'head', hc);
      if (hi) b.box([0.06, 0.03, 0.01], [0, 1.1, 0.155], 'head', '#ffffff');
      break;
    case 'fitted':
      b.sphere([0, 1.04, 0], 0.162, 'head', hc, [1, 0.9, 1], { thetaLength: Math.PI / 2 });
      b.box([0.18, 0.018, 0.14], [0, 1.045, 0.2], 'head', hc);
      break;
    case 'bandana':
    case 'durag':
      b.sphere([0, 1.02, 0], 0.163, 'head', hc, [1, 0.95, 1], { thetaLength: Math.PI / 2.1 });
      b.sphere([0, 1.0, -0.16], 0.04, 'head', hc);
      b.box([0.035, 0.12, 0.015], [0.02, 0.92, -0.17], 'head', hc);
      break;
    case 'beanie':
      b.sphere([0, 1.05, 0], 0.165, 'head', hc, [1, 1.1, 1], { thetaLength: Math.PI / 2 });
      break;
    case 'none':
      b.sphere([0, 1.03, 0], 0.158, 'head', '#181210', [1, 0.95, 1], { thetaLength: Math.PI / 2.4 });
      break;
    case 'cop_cap':
      b.cyl(0.15, 0.16, 0.09, [0, 1.13, 0], 'head', hc);
      b.box([0.2, 0.015, 0.12], [0, 1.09, 0.17], 'head', '#0b0c10', [0.2, 0, 0]);
      b.box([0.05, 0.04, 0.01], [0, 1.14, 0.155], 'head', '#ffcc33');
      break;
    case 'riot_helmet':
    case 'swat_helmet':
    case 'moto_helmet':
      b.sphere([0, 1.02, 0], 0.185, 'head', hc, [1, 1, 1.05], { thetaLength: Math.PI / 1.7 });
      if (look.hat !== 'swat_helmet') b.box([0.26, 0.11, 0.02], [0, 0.98, 0.18], 'head', '#6f8fbf');
      break;
  }

  // weapon in the right hand (points forward along +z once the arm aims)
  if (look.weapon === 'pistol') {
    b.box([0.035, 0.06, 0.03], [-0.22 * k, 0.43, 0.02], 'handR', '#1b1c20');
    b.box([0.035, 0.03, 0.15], [-0.22 * k, 0.4, 0.06], 'handR', '#2a2b30', [0, 0, 0]);
  } else if (look.weapon === 'rifle') {
    b.box([0.04, 0.05, 0.36], [-0.22 * k, 0.4, 0.1], 'handR', '#1b1c20');
    b.box([0.03, 0.08, 0.04], [-0.22 * k, 0.37, 0.05], 'handR', '#1b1c20');
  } else if (look.weapon === 'baton' || look.weapon === 'bat') {
    b.cyl(0.02, 0.024, 0.42, [-0.22 * k, 0.3, 0.02], 'handR', look.weapon === 'bat' ? '#a87b4f' : '#111114');
  }
  if (look.shield) {
    b.box([0.34, 0.5, 0.03], [0.2, 0.5, 0.2], 'foreArmL', '#9fb3cc');
    b.box([0.3, 0.05, 0.035], [0.2, 0.7, 0.2], 'foreArmL', '#1c2130');
  }

  const g = mergeGeometries(b.parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Fresh skeleton in bind pose. Bone order matches BONES (skinIndex). */
export function buildSkeleton(): { bones: THREE.Bone[]; root: THREE.Bone; skeleton: THREE.Skeleton } {
  const map = new Map<BoneName, THREE.Bone>();
  for (const name of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    map.set(name, bone);
  }
  for (const name of BONES) {
    const j = JOINTS[name];
    const bone = map.get(name)!;
    const pp = j.parent ? JOINTS[j.parent].p : [0, 0, 0];
    bone.position.set(j.p[0] - pp[0], j.p[1] - pp[1], j.p[2] - pp[2]);
    if (j.parent) map.get(j.parent)!.add(bone);
  }
  const root = map.get('hips')!;
  root.updateMatrixWorld(true);
  const bones = BONES.map((n) => map.get(n)!);
  return { bones, root, skeleton: new THREE.Skeleton(bones) };
}

export function buildSkinnedMesh(look: Look, detail: 'hi' | 'lo', material: THREE.Material): THREE.SkinnedMesh {
  const geo = buildHumanoidGeometry(look, detail);
  const { root, skeleton } = buildSkeleton();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ clips
type Key = [t: number, x: number, y?: number, z?: number];

function clip(name: string, duration: number, rot: Partial<Record<BoneName, Key[]>>, hipsY?: [number, number][]): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const [bone, keys] of Object.entries(rot) as [BoneName, Key[]][]) {
    const times: number[] = [];
    const values: number[] = [];
    for (const [t, x, y = 0, z = 0] of keys) {
      times.push(t);
      q.setFromEuler(e.set(x, y, z, 'XYZ'));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  if (hipsY) {
    const base = JOINTS.hips.p;
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', hipsY.map((k) => k[0]), hipsY.flatMap(([, y]) => [base[0], base[1] + y, base[2]])));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Both hands up on the weapon, elbows bent: shared upper body for aim poses. */
const AIM = { upR: [-1.35, 0.25, 0] as const, foreR: [-0.15, 0, 0] as const, upL: [-1.25, -0.55, 0] as const, foreL: [-0.35, 0, 0] as const };
const aimKeys = (t: number, dx = 0): Partial<Record<BoneName, Key[]>> => ({
  upperArmR: [[t, AIM.upR[0] + dx, AIM.upR[1], AIM.upR[2]]],
  foreArmR: [[t, AIM.foreR[0], 0, 0]],
  upperArmL: [[t, AIM.upL[0] + dx, AIM.upL[1], AIM.upL[2]]],
  foreArmL: [[t, AIM.foreL[0], 0, 0]],
});
function mergeKeys(...sets: Partial<Record<BoneName, Key[]>>[]): Partial<Record<BoneName, Key[]>> {
  const out: Partial<Record<BoneName, Key[]>> = {};
  for (const s of sets) for (const [k, v] of Object.entries(s) as [BoneName, Key[]][]) (out[k] ??= []).push(...v);
  for (const v of Object.values(out)) v!.sort((a, b) => a[0] - b[0]);
  return out;
}

export function humanoidClips(): Record<'run' | 'aim' | 'shoot' | 'fall' | 'cheer' | 'idle', THREE.AnimationClip> {
  const T = 0.6;
  const run = clip(
    'run',
    T,
    mergeKeys(
      {
        thighL: [[0, -0.85], [0.15, -0.1], [0.3, 0.65], [0.45, -0.2], [0.6, -0.85]],
        thighR: [[0, 0.65], [0.15, -0.2], [0.3, -0.85], [0.45, -0.1], [0.6, 0.65]],
        shinL: [[0, 0.25], [0.15, 0.2], [0.3, 0.35], [0.45, 1.4], [0.6, 0.25]],
        shinR: [[0, 0.35], [0.15, 1.4], [0.3, 0.25], [0.45, 0.2], [0.6, 0.35]],
        spine: [[0, 0.18, 0.12], [0.3, 0.18, -0.12], [0.6, 0.18, 0.12]],
        chest: [[0, 0.05, -0.1], [0.3, 0.05, 0.1], [0.6, 0.05, -0.1]],
        head: [[0, -0.2], [0.6, -0.2]],
      },
      { upperArmR: [[0, AIM.upR[0], AIM.upR[1]], [0.15, AIM.upR[0] - 0.07, AIM.upR[1]], [0.3, AIM.upR[0], AIM.upR[1]], [0.45, AIM.upR[0] - 0.07, AIM.upR[1]], [0.6, AIM.upR[0], AIM.upR[1]]] },
      { upperArmL: [[0, AIM.upL[0], AIM.upL[1]], [0.15, AIM.upL[0] - 0.07, AIM.upL[1]], [0.3, AIM.upL[0], AIM.upL[1]], [0.45, AIM.upL[0] - 0.07, AIM.upL[1]], [0.6, AIM.upL[0], AIM.upL[1]]] },
      { foreArmR: [[0, AIM.foreR[0]], [0.6, AIM.foreR[0]]], foreArmL: [[0, AIM.foreL[0]], [0.6, AIM.foreL[0]]] },
    ),
    [[0, -0.02], [0.15, 0.035], [0.3, -0.02], [0.45, 0.035], [0.6, -0.02]],
  );
  const stance = (t: number): Partial<Record<BoneName, Key[]>> => ({
    thighL: [[t, -0.25, 0, 0.12]],
    shinL: [[t, 0.35]],
    thighR: [[t, 0.2, 0, -0.1]],
    shinR: [[t, 0.25]],
  });
  const aim = clip(
    'aim',
    1.6,
    mergeKeys(stance(0), stance(1.6), aimKeys(0), aimKeys(0.8, -0.04), aimKeys(1.6), {
      spine: [[0, 0.08, 0.35], [0.8, 0.11, 0.35], [1.6, 0.08, 0.35]],
      chest: [[0, 0, -0.25], [1.6, 0, -0.25]],
      head: [[0, -0.05, -0.1], [1.6, -0.05, -0.1]],
    }),
    [[0, -0.04], [0.8, -0.05], [1.6, -0.04]],
  );
  const shoot = clip(
    'shoot',
    0.24,
    mergeKeys(stance(0), stance(0.24), aimKeys(0), aimKeys(0.05, -0.28), aimKeys(0.24), {
      spine: [[0, 0.08, 0.35], [0.05, -0.04, 0.35], [0.24, 0.08, 0.35]],
      chest: [[0, 0, -0.25], [0.24, 0, -0.25]],
    }),
    [[0, -0.04], [0.24, -0.04]],
  );
  const fall = clip(
    'fall',
    0.9,
    {
      hips: [[0, 0], [0.25, -0.6], [0.55, -1.5], [0.7, -1.38], [0.9, -1.5]],
      spine: [[0, 0], [0.3, -0.3], [0.9, -0.1]],
      head: [[0, 0], [0.3, 0.4], [0.6, -0.3], [0.9, -0.1]],
      upperArmL: [[0, -0.3], [0.3, -2.6, 0, 0.6], [0.9, -2.9, 0, 1.0]],
      upperArmR: [[0, -0.3], [0.3, -2.6, 0, -0.6], [0.9, -2.9, 0, -1.0]],
      foreArmL: [[0, 0], [0.9, -0.4]],
      foreArmR: [[0, 0], [0.9, -0.4]],
      thighL: [[0, 0], [0.4, -0.9], [0.9, -0.3, 0, 0.2]],
      thighR: [[0, 0], [0.4, -0.5], [0.9, -0.1, 0, -0.2]],
      shinL: [[0, 0], [0.4, 0.8], [0.9, 0.2]],
      shinR: [[0, 0], [0.4, 0.6], [0.9, 0.4]],
    },
    [[0, 0], [0.25, -0.1], [0.55, -0.36], [0.7, -0.3], [0.9, -0.37]],
  );
  const cheer = clip(
    'cheer',
    0.8,
    {
      upperArmL: [[0, -2.7, 0, 0.35], [0.4, -3.0, 0, 0.2], [0.8, -2.7, 0, 0.35]],
      upperArmR: [[0, -2.7, 0, -0.35], [0.4, -3.0, 0, -0.2], [0.8, -2.7, 0, -0.35]],
      foreArmL: [[0, -0.5], [0.4, -0.2], [0.8, -0.5]],
      foreArmR: [[0, -0.5], [0.4, -0.2], [0.8, -0.5]],
      thighL: [[0, -0.2], [0.4, -0.5], [0.8, -0.2]],
      thighR: [[0, -0.2], [0.4, -0.5], [0.8, -0.2]],
      shinL: [[0, 0.4], [0.4, 0.9], [0.8, 0.4]],
      shinR: [[0, 0.4], [0.4, 0.9], [0.8, 0.4]],
      head: [[0, -0.25], [0.8, -0.25]],
    },
    [[0, -0.05], [0.2, 0.1], [0.4, 0.14], [0.6, 0.05], [0.8, -0.05]],
  );
  const idle = clip(
    'idle',
    2,
    {
      upperArmL: [[0, -0.05, 0, 0.12], [1, -0.08, 0, 0.14], [2, -0.05, 0, 0.12]],
      upperArmR: [[0, -0.35, 0, -0.12], [1, -0.38, 0, -0.14], [2, -0.35, 0, -0.12]],
      foreArmR: [[0, -0.4], [2, -0.4]],
      chest: [[0, 0], [1, 0.04], [2, 0]],
      thighL: [[0, 0, 0, 0.06], [2, 0, 0, 0.06]],
      thighR: [[0, 0, 0, -0.06], [2, 0, 0, -0.06]],
    },
    [[0, 0], [1, -0.008], [2, 0]],
  );
  return { run, aim, shoot, fall, cheer, idle };
}

/** Boss-only moves on the same rig (played via AnimationMixer). */
export function bossClips(): Record<'idle' | 'windup' | 'slam' | 'shield' | 'roar' | 'topple', THREE.AnimationClip> {
  const idle = clip(
    'idle',
    2.4,
    {
      chest: [[0, 0.05], [1.2, 0.1], [2.4, 0.05]],
      upperArmR: [[0, -0.3, 0, -0.25], [1.2, -0.35, 0, -0.28], [2.4, -0.3, 0, -0.25]],
      foreArmR: [[0, -0.6], [2.4, -0.6]],
      upperArmL: [[0, -0.1, 0, 0.25], [1.2, -0.12, 0, 0.28], [2.4, -0.1, 0, 0.25]],
      thighL: [[0, -0.1, 0, 0.12], [2.4, -0.1, 0, 0.12]],
      thighR: [[0, 0.1, 0, -0.12], [2.4, 0.1, 0, -0.12]],
      shinL: [[0, 0.15], [2.4, 0.15]],
      head: [[0, 0.05], [1.2, -0.05], [2.4, 0.05]],
    },
    [[0, -0.02], [1.2, -0.03], [2.4, -0.02]],
  );
  const windup = clip(
    'windup',
    1,
    {
      upperArmR: [[0, -0.3, 0, -0.25], [1, -3.0, 0, -0.1]],
      foreArmR: [[0, -0.6], [1, -0.9]],
      chest: [[0, 0.05], [1, -0.3, 0.3, 0]],
      spine: [[0, 0], [1, -0.15]],
      upperArmL: [[0, -0.1, 0, 0.25], [1, -0.6, 0, 0.6]],
      head: [[0, 0], [1, -0.2]],
      thighL: [[0, -0.1, 0, 0.12], [1, -0.4, 0, 0.15]],
      shinL: [[0, 0.15], [1, 0.5]],
    },
  );
  const slam = clip(
    'slam',
    0.7,
    {
      upperArmR: [[0, -3.0, 0, -0.1], [0.12, -0.7, 0, -0.1], [0.7, -0.5, 0, -0.2]],
      foreArmR: [[0, -0.9], [0.12, -0.1], [0.7, -0.4]],
      chest: [[0, -0.3, 0.3, 0], [0.12, 0.55, -0.1, 0], [0.7, 0.25]],
      spine: [[0, -0.15], [0.12, 0.35], [0.7, 0.15]],
      upperArmL: [[0, -0.6, 0, 0.6], [0.12, -0.2, 0, 0.5], [0.7, -0.1, 0, 0.3]],
      thighL: [[0, -0.4, 0, 0.15], [0.12, -0.7, 0, 0.15], [0.7, -0.4]],
      shinL: [[0, 0.5], [0.12, 0.9], [0.7, 0.5]],
      thighR: [[0, 0.1], [0.12, 0.4], [0.7, 0.2]],
    },
    [[0, 0], [0.12, -0.08], [0.7, -0.05]],
  );
  const shield = clip(
    'shield',
    1,
    {
      upperArmL: [[0, -1.5, -0.6, 0], [1, -1.55, -0.6, 0]],
      foreArmL: [[0, -0.6], [1, -0.6]],
      upperArmR: [[0, -0.6, 0, -0.3], [1, -0.6, 0, -0.3]],
      chest: [[0, 0.15], [1, 0.18]],
      thighL: [[0, -0.35, 0, 0.15], [1, -0.35, 0, 0.15]],
      shinL: [[0, 0.5], [1, 0.5]],
      thighR: [[0, 0.3, 0, -0.1], [1, 0.3, 0, -0.1]],
    },
    [[0, -0.06], [1, -0.06]],
  );
  const roar = clip(
    'roar',
    1.2,
    {
      chest: [[0, 0], [0.3, -0.35], [0.9, -0.35], [1.2, 0]],
      head: [[0, 0], [0.3, -0.4], [0.9, -0.4], [1.2, 0]],
      upperArmL: [[0, -0.1, 0, 0.3], [0.3, -0.4, 0, 1.4], [0.9, -0.4, 0, 1.5], [1.2, -0.1, 0, 0.3]],
      upperArmR: [[0, -0.3, 0, -0.3], [0.3, -0.4, 0, -1.4], [0.9, -0.4, 0, -1.5], [1.2, -0.3, 0, -0.3]],
      foreArmL: [[0, 0], [0.3, -1.2], [1.2, 0]],
      foreArmR: [[0, -0.6], [0.3, -1.2], [1.2, -0.6]],
    },
  );
  const topple = clip(
    'topple',
    1.8,
    {
      hips: [[0, 0], [0.5, -0.25], [1.4, -1.5], [1.6, -1.42], [1.8, -1.5]],
      chest: [[0, 0], [0.5, 0.3], [1.8, -0.1]],
      head: [[0, 0], [0.6, 0.5], [1.8, -0.2]],
      upperArmL: [[0, -0.1], [0.6, -1.0, 0, 1.0], [1.8, -2.8, 0, 1.2]],
      upperArmR: [[0, -0.3], [0.6, -1.0, 0, -1.0], [1.8, -2.8, 0, -1.2]],
      thighL: [[0, 0], [0.6, 0.3], [1.8, -0.6]],
      thighR: [[0, 0], [0.6, 0.2], [1.8, -0.4]],
      shinL: [[0, 0], [0.6, 0.8], [1.8, 0.2]],
      shinR: [[0, 0], [0.6, 0.9], [1.8, 0.3]],
    },
    [[0, 0], [0.5, -0.12], [1.4, -0.38], [1.6, -0.33], [1.8, -0.38]],
  );
  return { idle, windup, slam, shield, roar, topple };
}

/** Character-select idle poses (config `idlePose`), subtle breathing loops. */
export function idlePoseClips(): Record<'lean_phone' | 'arms_crossed_sleeve' | 'hands_in_pockets' | 'chin_up', THREE.AnimationClip> {
  const lean_phone = clip(
    'lean_phone',
    2.4,
    {
      spine: [[0, -0.12, 0, 0.06], [1.2, -0.14, 0, 0.07], [2.4, -0.12, 0, 0.06]],
      head: [[0, 0.35, 0.15], [1.2, 0.38, 0.12], [2.4, 0.35, 0.15]],
      upperArmR: [[0, -0.6, 0.5, -0.1], [2.4, -0.6, 0.5, -0.1]],
      foreArmR: [[0, -1.5], [1.2, -1.45], [2.4, -1.5]],
      upperArmL: [[0, 0.1, 0, 0.18], [2.4, 0.1, 0, 0.18]],
      thighL: [[0, -0.15, 0, 0.05], [2.4, -0.15, 0, 0.05]],
      thighR: [[0, 0.35, 0.2, -0.25], [2.4, 0.35, 0.2, -0.25]],
      shinR: [[0, 0.9], [2.4, 0.9]],
    },
    [[0, -0.02], [1.2, -0.03], [2.4, -0.02]],
  );
  const arms_crossed_sleeve = clip(
    'arms_crossed_sleeve',
    2.4,
    {
      upperArmL: [[0, -0.75, -0.9, 0.2], [1.2, -0.78, -0.9, 0.2], [2.4, -0.75, -0.9, 0.2]],
      foreArmL: [[0, -1.7, 0, 0], [2.4, -1.7, 0, 0]],
      upperArmR: [[0, -0.8, 0.9, -0.2], [1.6, -0.9, 0.95, -0.2], [2.0, -0.8, 0.9, -0.2], [2.4, -0.8, 0.9, -0.2]],
      foreArmR: [[0, -1.6], [1.6, -1.8], [2.4, -1.6]],
      chest: [[0, -0.05], [1.2, -0.02], [2.4, -0.05]],
      head: [[0, -0.1, 0.2], [2.4, -0.1, 0.2]],
      thighL: [[0, 0, 0, 0.12], [2.4, 0, 0, 0.12]],
      thighR: [[0, 0, 0, -0.12], [2.4, 0, 0, -0.12]],
    },
    [[0, 0], [1.2, -0.01], [2.4, 0]],
  );
  const hands_in_pockets = clip(
    'hands_in_pockets',
    2.4,
    {
      upperArmL: [[0, 0.15, 0, 0.12], [2.4, 0.15, 0, 0.12]],
      foreArmL: [[0, -0.6], [2.4, -0.6]],
      upperArmR: [[0, 0.15, 0, -0.12], [2.4, 0.15, 0, -0.12]],
      foreArmR: [[0, -0.6], [2.4, -0.6]],
      spine: [[0, 0, 0.1], [1.2, 0, 0.14], [2.4, 0, 0.1]],
      head: [[0, 0.05, -0.25], [1.2, 0.0, -0.3], [2.4, 0.05, -0.25]],
      thighL: [[0, 0, 0, 0.1], [2.4, 0, 0, 0.1]],
      thighR: [[0, 0.1, 0, -0.08], [2.4, 0.1, 0, -0.08]],
    },
  );
  const chin_up = clip(
    'chin_up',
    2.4,
    {
      head: [[0, -0.25], [1.2, -0.28], [2.4, -0.25]],
      chest: [[0, -0.1], [1.2, -0.12], [2.4, -0.1]],
      upperArmL: [[0, -0.1, 0, 0.35], [2.4, -0.1, 0, 0.35]],
      upperArmR: [[0, -0.1, 0, -0.35], [2.4, -0.1, 0, -0.35]],
      foreArmL: [[0, -0.4], [2.4, -0.4]],
      foreArmR: [[0, -0.4], [2.4, -0.4]],
      thighL: [[0, 0, 0, 0.16], [2.4, 0, 0, 0.16]],
      thighR: [[0, 0, 0, -0.16], [2.4, 0, 0, -0.16]],
    },
    [[0, -0.01], [1.2, 0.0], [2.4, -0.01]],
  );
  return { lean_phone, arms_crossed_sleeve, hands_in_pockets, chin_up };
}
