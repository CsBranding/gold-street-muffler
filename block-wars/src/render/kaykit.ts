/**
 * Modeled characters and street props (KayKit, CC0 — see public/assets/models/LICENSE-*).
 *
 * Characters are loaded once, converted from their texture atlas to vertex
 * colors (the stylized toon material is vertex-colored), recolored per
 * faction by color class, and either
 *  - baked into VAT crowds (bakeKayKitVat), or
 *  - cloned as a SkeletonUtils rig with crossfaded clips (kayKitActor).
 * If the models fail to load the renderer keeps the procedural rig.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Look } from './rig';
import type { VatAsset, VatClip } from './vat';

export type KKModel = 'rogue_hooded' | 'rogue' | 'knight' | 'barbarian';
const MODELS: KKModel[] = ['rogue_hooded', 'rogue', 'knight', 'barbarian'];

/** our clip names → KayKit clip names */
export const KK_CLIPS = {
  run: 'Running_A',
  aim: '1H_Ranged_Aiming',
  shoot: '1H_Ranged_Shooting',
  fall: 'Death_A',
  cheer: 'Cheer',
  idle: 'Idle',
  hit: 'Hit_A',
  // boss
  windup: 'Spellcast_Raise',
  slam: '2H_Melee_Attack_Chop',
  shield: 'Blocking',
  roar: 'Cheer',
  topple: 'Death_B',
  guard: '2H_Melee_Idle',
  relaxed: 'Unarmed_Idle',
} as const;

interface Source {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  atlas: { data: Uint8ClampedArray; w: number; h: number };
}

const sources = new Map<KKModel, Source>();
const props = new Map<string, THREE.Object3D>();
let loading: Promise<boolean> | null = null;

export function kayKitReady(): boolean {
  return sources.size === MODELS.length;
}

function readAtlas(tex: THREE.Texture | null): Source['atlas'] {
  const img = tex?.image as CanvasImageSource & { width: number; height: number };
  const w = img?.width ?? 1;
  const h = img?.height ?? 1;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (img) g.drawImage(img, 0, 0);
  return { data: g.getImageData(0, 0, w, h).data, w, h };
}

/** Loads every model in parallel; resolves false (procedural fallback) on any failure. */
export function loadKayKit(base = 'assets/models/'): Promise<boolean> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  // a single-file build can inline the models as data: URIs
  const inlined = (globalThis as { __BW_MODELS?: Record<string, string> }).__BW_MODELS;
  const url = (name: string) => inlined?.[name] ?? `${base}${name}.glb`;
  loading = Promise.all([
    ...MODELS.map(async (m) => {
      const gltf = await loader.loadAsync(url(m));
      let tex: THREE.Texture | null = null;
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !tex) tex = (mesh.material as THREE.MeshStandardMaterial).map;
      });
      sources.set(m, { scene: gltf.scene, clips: new Map(gltf.animations.map((a) => [a.name, a])), atlas: readAtlas(tex) });
    }),
    (async () => {
      const gltf = await loader.loadAsync(url('city'));
      for (const c of [...gltf.scene.children]) props.set(c.name, c);
    })(),
  ])
    .then(() => true)
    .catch((err) => {
      console.warn('KayKit models unavailable, using procedural rig', err);
      sources.clear();
      return false;
    });
  return loading;
}

// ------------------------------------------------------------- recoloring
export interface KKSpec {
  model: KKModel;
  skin: string;
  /** hoodie / uniform / jacket */
  main: string;
  /** straps, vest, under-shirt */
  second: string;
  legs: string;
  boots: string;
  hair: string;
  helmet: boolean;
  helmetColor: string;
  weapon: Look['weapon'];
  bulk: number;
}

/** Pick the model and palette that read closest to a procedural Look. */
export function specFromLook(look: Look): KKSpec {
  const cop = look.top === 'uniform';
  const helmeted = cop && (look.hat === 'riot_helmet' || look.hat === 'swat_helmet');
  const model: KKModel = helmeted ? 'knight' : cop ? 'rogue' : look.bulk > 1.15 || look.top === 'puffer' ? 'barbarian' : look.top === 'hoodie_open' || look.hat === 'beanie' ? 'rogue_hooded' : 'rogue';
  return {
    model,
    skin: look.skin,
    main: look.topColor,
    second: cop ? '#0d1118' : look.top === 'tee' ? look.topColor : look.shirtColor,
    legs: look.pantsColor,
    boots: look.shoeColor,
    hair: cop || model === 'barbarian' ? '#2a1d14' : look.hatColor,
    helmet: helmeted,
    helmetColor: look.hat === 'moto_helmet' ? '#e8e8e8' : '#2c3650',
    weapon: look.weapon,
    bulk: look.bulk,
  };
}

const hsl = { h: 0, s: 0, l: 0 };
const tmpC = new THREE.Color();
const outC = new THREE.Color();

type Slot = 'keep' | 'skin' | 'main' | 'second' | 'legs' | 'boots' | 'hair' | 'helmet';

/** Classify one atlas color on one part of one model into a palette slot. */
function slotOf(model: KKModel, part: string, c: THREE.Color): { slot: Slot; ref: number } {
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const h = hsl.h * 360;
  const { s, l } = hsl;
  if (l < 0.16) return { slot: 'keep', ref: 1 }; // eyes, brows, soles
  if (s > 0.45 && l > 0.62 && h > 10 && h < 40) return { slot: 'skin', ref: 0.78 };
  const brown = h > 5 && h < 40 && s > 0.2 && s < 0.75 && l < 0.62;
  const grey = s < 0.2;
  if (model === 'rogue' || model === 'rogue_hooded') {
    if (h > 140 && h < 190 && s > 0.35) return { slot: 'main', ref: 0.27 };
    if (brown) {
      if (/Leg/.test(part)) return { slot: 'legs', ref: 0.48 };
      if (/Head/.test(part)) return { slot: model === 'rogue_hooded' ? 'main' : 'hair', ref: 0.45 };
      return { slot: 'second', ref: 0.46 };
    }
    if (grey) return { slot: 'second', ref: 0.45 };
  } else if (model === 'knight') {
    if (/Helmet/.test(part)) return { slot: grey ? 'helmet' : 'keep', ref: 0.42 };
    if (grey) return { slot: /Leg/.test(part) ? 'legs' : 'main', ref: 0.45 };
    if (h < 12 || h > 345) return { slot: 'second', ref: 0.48 };
    if (brown) return { slot: /Head/.test(part) ? 'hair' : 'boots', ref: 0.42 };
    if (/Head/.test(part)) return { slot: 'hair', ref: 0.65 };
  } else {
    if (h > 190 && h < 225 && s > 0.15) return { slot: 'main', ref: 0.4 };
    if (grey && l > 0.7) return { slot: 'second', ref: 0.8 };
    if (/Head/.test(part) && (grey || brown)) return { slot: 'hair', ref: 0.45 };
    if (brown || grey) return { slot: /Leg/.test(part) ? 'legs' : 'second', ref: 0.42 };
  }
  return { slot: 'keep', ref: 1 };
}

function recolorGeometry(geo: THREE.BufferGeometry, src: Source, model: KKModel, part: string, spec: KKSpec): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const { data, w, h } = src.atlas;
  const pal: Record<Slot, THREE.Color | null> = {
    keep: null,
    skin: new THREE.Color(spec.skin),
    main: new THREE.Color(spec.main),
    second: new THREE.Color(spec.second),
    legs: new THREE.Color(spec.legs),
    boots: new THREE.Color(spec.boots),
    hair: new THREE.Color(spec.hair),
    helmet: new THREE.Color(spec.helmetColor),
  };
  for (let i = 0; i < n; i++) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(uv.getX(i) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(uv.getY(i) * h)));
    const o = (y * w + x) * 4;
    tmpC.setRGB(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, THREE.SRGBColorSpace);
    const { slot, ref } = slotOf(model, part, tmpC);
    const target = pal[slot];
    if (target) {
      // keep the atlas' painted shading: scale the target by the source's relative lightness
      tmpC.getHSL(hsl, THREE.SRGBColorSpace);
      outC.copy(target).multiplyScalar(THREE.MathUtils.clamp(hsl.l / ref, 0.7, 1.25));
    } else outC.copy(tmpC);
    outC.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---------------------------------------------------------------- weapons
function weaponGeometry(kind: Look['weapon']): THREE.BufferGeometry | null {
  if (kind === 'none') return null;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => {
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  // handslot space: +y along the fingers, +z forward out of the fist
  if (kind === 'pistol' || kind === 'rifle') {
    const len = kind === 'rifle' ? 0.95 : 0.42;
    add(new THREE.BoxGeometry(0.11, 0.16, len).translate(0, 0.05, len / 2 - 0.08), '#1b1d22');
    add(new THREE.BoxGeometry(0.09, 0.26, 0.11).translate(0, -0.08, -0.02), '#2b2e35');
    if (kind === 'rifle') add(new THREE.BoxGeometry(0.08, 0.24, 0.12).translate(0, -0.1, 0.32), '#1b1d22');
  } else {
    const l = kind === 'bat' ? 1.0 : 0.75;
    add(new THREE.CylinderGeometry(kind === 'bat' ? 0.07 : 0.045, 0.035, l, 8).translate(0, l / 2 - 0.1, 0), kind === 'bat' ? '#b98a52' : '#16181d');
  }
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nrm.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------ instancing
interface Prepared {
  root: THREE.Object3D;
  skinned: THREE.SkinnedMesh[];
  rigid: THREE.Mesh[];
  clips: Map<string, THREE.AnimationClip>;
}

/** Height our units are authored for (matches the procedural rig, ~1.05 m at scale 1). */
export const UNIT_HEIGHT = 1.05;

/** Clone a model, recolor it, hide the props it doesn't use and attach the weapon. */
function prepare(spec: KKSpec, material: THREE.Material): Prepared {
  const src = sources.get(spec.model)!;
  const root = SkeletonUtils.clone(src.scene);
  const skinned: THREE.SkinnedMesh[] = [];
  const rigid: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (/Helmet/.test(m.name) && !spec.helmet) {
      m.visible = false;
      return;
    }
    m.geometry = m.geometry.clone();
    recolorGeometry(m.geometry, src, spec.model, m.name, spec);
    m.material = material;
    m.castShadow = true;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(m as THREE.SkinnedMesh);
    else rigid.push(m);
  });
  const wg = weaponGeometry(spec.weapon);
  const hand = root.getObjectByName('handslot.r');
  if (wg && hand) {
    const wm = new THREE.Mesh(wg, material);
    wm.name = 'weapon';
    wm.castShadow = true;
    hand.add(wm);
    rigid.push(wm);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of skinned) {
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  }
  const fit = UNIT_HEIGHT / Math.max(0.1, box.max.y - box.min.y);
  root.scale.multiplyScalar(fit);
  root.scale.x *= spec.bulk;
  root.scale.z *= spec.bulk;
  return { root, skinned, rigid, clips: src.clips };
}

/** A rigged, animated character (leader, boss, previews). Clips keyed by our names. */
export function kayKitActor(spec: KKSpec, material: THREE.Material): { object: THREE.Object3D; clips: Record<string, THREE.AnimationClip> } {
  const p = prepare(spec, material);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const [ours, theirs] of Object.entries(KK_CLIPS)) {
    const c = p.clips.get(theirs);
    if (c) clips[ours] = c;
  }
  const holder = new THREE.Group();
  holder.add(p.root);
  return { object: holder, clips };
}

const vatCache = new Map<string, VatAsset>();
const BAKE: { name: keyof typeof KK_CLIPS; fps: number; loop: boolean }[] = [
  { name: 'run', fps: 30, loop: true },
  { name: 'aim', fps: 12, loop: true },
  { name: 'shoot', fps: 20, loop: true },
  { name: 'fall', fps: 20, loop: false },
  { name: 'cheer', fps: 12, loop: true },
];

/** Bake a model into vertex-animation textures for instanced crowds (cached per spec). */
export function bakeKayKitVat(spec: KKSpec): VatAsset {
  const key = JSON.stringify(spec);
  const hit = vatCache.get(key);
  if (hit) return hit;
  const t0 = performance.now();
  const p = prepare(spec, new THREE.MeshBasicMaterial());
  const parts = [...p.skinned, ...p.rigid].filter((m) => m.visible);
  let V = 0;
  const offs: number[] = [];
  for (const m of parts) {
    offs.push(V);
    V += m.geometry.attributes.position.count;
  }
  // merged static geometry (indexed so gl_VertexID addresses the VAT texel)
  const color = new Float32Array(V * 3);
  const idx: number[] = [];
  parts.forEach((m, k) => {
    color.set(m.geometry.attributes.color.array as Float32Array, offs[k] * 3);
    const g = m.geometry;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + offs[k]);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + offs[k]);
  });
  const width = Math.min(1024, V);
  const rowsPerFrame = Math.ceil(V / width);
  const mixer = new THREE.AnimationMixer(p.root);
  const info: Record<string, VatClip> = {};
  let total = 0;
  const list = BAKE.map((b) => ({ ...b, clip: p.clips.get(KK_CLIPS[b.name])! })).filter((b) => b.clip);
  for (const b of list) {
    const frames = Math.max(2, Math.round(b.clip.duration * b.fps) + (b.loop ? 0 : 1));
    info[b.name] = { start: total, frames, fps: b.fps, loop: b.loop, duration: b.clip.duration };
    total += frames;
  }
  const height = total * rowsPerFrame;
  const posData = new Uint16Array(width * height * 4);
  const nrmData = new Uint16Array(width * height * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const inv = new THREE.Matrix4();
  const pre = new THREE.Matrix4();
  const tmpM4 = new THREE.Matrix4();
  const blend = new Float32Array(16);
  const ONE = toHalf(1);
  const restPos = new Float32Array(V * 3);
  const restNrm = new Float32Array(V * 3);
  const holder = new THREE.Group();
  holder.add(p.root);
  // glTF attributes may be interleaved and/or normalized: flatten them once through the accessors
  const read = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, size: number) => {
    if (!a) return null;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) for (let q = 0; q < size; q++) out[i * size + q] = a.getComponent(i, q);
    return out;
  };
  const flat = parts.map((m) => {
    const at = m.geometry.attributes;
    return { pos: read(at.position, 3)!, nrm: read(at.normal, 3)!, si: read(at.skinIndex, 4), sw: read(at.skinWeight, 4) };
  });
  for (const b of list) {
    const ci = info[b.name];
    const action = mixer.clipAction(b.clip);
    action.play();
    for (let f = 0; f < ci.frames; f++) {
      mixer.setTime(b.loop ? (f / ci.frames) * b.clip.duration : Math.min(b.clip.duration, f / b.fps));
      holder.updateMatrixWorld(true);
      inv.copy(holder.matrixWorld).invert();
      parts.forEach((m, k) => {
        const { pos, nrm, si: siA, sw: swA } = flat[k];
        const n = pos.length / 3;
        const sk = (m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh) : null;
        // one combined matrix per bone (or one for a rigid part), then blend per vertex
        let mats: Float32Array;
        let si: ArrayLike<number> | null = null;
        let sw: ArrayLike<number> | null = null;
        if (sk) {
          sk.skeleton.update();
          const bm = sk.skeleton.boneMatrices;
          const nb = sk.skeleton.bones.length;
          mats = new Float32Array(nb * 16);
          pre.copy(inv).multiply(sk.matrixWorld).multiply(sk.bindMatrixInverse);
          for (let j = 0; j < nb; j++) {
            tmpM4.fromArray(bm, j * 16).premultiply(pre).multiply(sk.bindMatrix);
            mats.set(tmpM4.elements, j * 16);
          }
          si = siA;
          sw = swA;
        } else {
          mats = new Float32Array(tmpM4.copy(inv).multiply(m.matrixWorld).elements);
        }
        const e = blend;
        for (let i = 0; i < n; i++) {
          if (si && sw) {
            e.fill(0);
            for (let q = 0; q < 4; q++) {
              const w = sw[i * 4 + q];
              if (w === 0) continue;
              const base = si[i * 4 + q] * 16;
              for (let c = 0; c < 16; c++) e[c] += mats[base + c] * w;
            }
          } else e.set(mats.subarray(0, 16));
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          const px = e[0] * x + e[4] * y + e[8] * z + e[12];
          const py = e[1] * x + e[5] * y + e[9] * z + e[13];
          const pz = e[2] * x + e[6] * y + e[10] * z + e[14];
          const nx0 = nrm[i * 3], ny0 = nrm[i * 3 + 1], nz0 = nrm[i * 3 + 2];
          let nx = e[0] * nx0 + e[4] * ny0 + e[8] * nz0;
          let ny = e[1] * nx0 + e[5] * ny0 + e[9] * nz0;
          let nz = e[2] * nx0 + e[6] * ny0 + e[10] * nz0;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
          const vi = offs[k] + i;
          const row = (ci.start + f) * rowsPerFrame + Math.floor(vi / width);
          const o = (row * width + (vi % width)) * 4;
          posData[o] = toHalf(px);
          posData[o + 1] = toHalf(py);
          posData[o + 2] = toHalf(pz);
          posData[o + 3] = ONE;
          nrmData[o] = toHalf(nx);
          nrmData[o + 1] = toHalf(ny);
          nrmData[o + 2] = toHalf(nz);
          if (b.name === 'run' && f === 0) {
            restPos[vi * 3] = px;
            restPos[vi * 3 + 1] = py;
            restPos[vi * 3 + 2] = pz;
            restNrm[vi * 3] = nx;
            restNrm[vi * 3 + 1] = ny;
            restNrm[vi * 3 + 2] = nz;
          }
        }
      });
    }
    action.stop();
    mixer.uncacheAction(b.clip);
  }
  const tex = (data: Uint16Array) => {
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(restPos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(restNrm, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setIndex(idx);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, UNIT_HEIGHT / 2, 0), UNIT_HEIGHT * 2);
  const asset: VatAsset = { geometry, pos: tex(posData), nrm: tex(nrmData), width, rowsPerFrame, clips: info };
  vatCache.set(key, asset);
  if (import.meta.env?.DEV) console.info(`VAT bake ${spec.model}: ${V} verts, ${total} frames, ${(performance.now() - t0).toFixed(0)} ms`);
  return asset;
}

// ------------------------------------------------------------------ props
/** A recolorable clone of a city prop (cars, buildings, street furniture). */
export function kayKitProp(name: string): THREE.Object3D | null {
  const p = props.get(name);
  if (!p) return null;
  const c = p.clone(true);
  c.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return c;
}

export function hasKayKitProps(): boolean {
  return props.size > 0;
}
