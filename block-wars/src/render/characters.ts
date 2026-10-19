/**
 * Low-poly placeholder characters. Each model is a single merged
 * BufferGeometry with vertex colors and an `aLimb` attribute; the run cycle
 * is done in the vertex shader (see crowdMaterial), so a crowd of 1,000 is
 * one InstancedMesh draw call with zero per-unit CPU animation.
 *
 * Silhouettes are deliberately chunky (big head, wide shoulders, baggy legs)
 * so outfits stay readable when units are a few pixels tall.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Outfit } from '../schema/types';

/** limb codes: 0 body, ±1 legs, ±2 arms (sign = side) */
type Limb = 0 | 1 | -1 | 2 | -2;

export const LEG_PIVOT = 0.45;
export const ARM_PIVOT = 0.77;

class Builder {
  parts: THREE.BufferGeometry[] = [];
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string | THREE.Color, limb: Limb = 0, rotY = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y + h / 2, z);
    return this.add(g, color, limb);
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: string | THREE.Color, seg = 8, limb: Limb = 0): this {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y + h / 2, z);
    return this.add(g, color, limb);
  }
  add(g: THREE.BufferGeometry, color: string | THREE.Color, limb: Limb): this {
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const limbs = new Float32Array(n).fill(limb);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aLimb', new THREE.BufferAttribute(limbs, 1));
    g.deleteAttribute('uv');
    this.parts.push(g);
    return this;
  }
  build(scale = 1): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    if (scale !== 1) g.scale(scale, scale, scale);
    g.computeBoundingSphere();
    return g;
  }
}

const darken = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

function legsAndShoes(b: Builder, pants: string, shoe: string, accent: string): void {
  for (const s of [1, -1] as const) {
    const x = 0.085 * s;
    // baggy jeans flare slightly at the bottom
    b.box(0.15, 0.2, 0.16, x, 0.07, 0, pants, s);
    b.box(0.135, 0.2, 0.145, x, 0.25, 0, pants, s);
    b.box(0.12, 0.07, 0.2, x, 0, 0.02, shoe, s);
    b.box(0.122, 0.025, 0.12, x, 0.045, 0.02, accent, s);
  }
}

function head(b: Builder, skin: string, outfit: Pick<Outfit, 'hat' | 'hatColor' | 'sunglasses'>, opts: { tattoo?: boolean } = {}): void {
  b.box(0.1, 0.05, 0.1, 0, 0.79, 0, skin);
  b.box(0.27, 0.27, 0.26, 0, 0.83, 0, skin);
  b.box(0.04, 0.05, 0.03, 0.14, 0.92, 0, '#c0c0c8'); // earring side
  if (opts.tattoo) b.box(0.11, 0.04, 0.005, 0.03, 0.8, 0.052, '#2b2b36');
  b.box(0.18, 0.03, 0.005, 0, 0.93, 0.131, '#20140f'); // brow line for face read
  if (outfit.sunglasses) b.box(0.24, 0.06, 0.03, 0, 0.92, 0.135, '#0b0b0f');
  const hc = outfit.hatColor;
  switch (outfit.hat) {
    case 'snapback_back':
      b.box(0.29, 0.1, 0.28, 0, 1.06, 0, hc);
      b.box(0.2, 0.025, 0.12, 0, 1.06, -0.18, hc); // brim backwards
      b.box(0.1, 0.03, 0.01, 0, 1.08, 0.141, '#ffffff');
      break;
    case 'bandana':
      b.box(0.29, 0.08, 0.285, 0, 1.03, 0, hc);
      b.box(0.08, 0.06, 0.06, 0, 1.0, -0.16, hc);
      b.box(0.04, 0.12, 0.02, 0.03, 0.9, -0.17, hc);
      break;
    case 'beanie':
      b.box(0.29, 0.12, 0.285, 0, 1.02, 0, hc);
      break;
    case 'durag':
      b.box(0.285, 0.07, 0.28, 0, 1.03, 0, hc);
      b.box(0.08, 0.16, 0.02, 0, 0.86, -0.14, hc);
      break;
    case 'fitted':
      b.box(0.29, 0.1, 0.28, 0, 1.06, 0, hc);
      b.box(0.24, 0.025, 0.14, 0, 1.06, 0.18, hc);
      break;
    case 'none':
      b.box(0.275, 0.04, 0.27, 0, 1.08, 0, '#141010');
      break;
  }
}

function arms(b: Builder, sleeve: string, skin: string, pushedUp: boolean, tattoo: boolean): void {
  for (const s of [1, -1] as const) {
    const x = 0.235 * s;
    const limb = (2 * s) as Limb;
    if (pushedUp) {
      b.box(0.11, 0.17, 0.12, x, 0.62, 0, sleeve, limb);
      b.box(0.095, 0.16, 0.1, x, 0.46, 0, tattoo ? darken(skin, 0.75) : skin, limb);
    } else {
      b.box(0.11, 0.3, 0.12, x, 0.49, 0, sleeve, limb);
    }
    b.box(0.09, 0.07, 0.09, x, 0.41, 0, skin, limb);
  }
}

/** Faction character from an outfit (crew follower or leader). */
export function buildCharacter(outfit: Outfit, skin: string, detail: 'crew' | 'leader'): THREE.BufferGeometry {
  const b = new Builder();
  legsAndShoes(b, outfit.pantsColor, outfit.shoeColor, outfit.shoeAccent);
  // long tee hanging below the top
  b.box(0.34, 0.09, 0.2, 0, 0.42, 0, outfit.shirtColor);
  const open = outfit.top === 'hoodie_open' || outfit.top === 'flannel_open';
  b.box(0.38, 0.33, 0.22, 0, 0.47, 0, outfit.topColor);
  if (open) b.box(0.13, 0.33, 0.01, 0, 0.47, 0.111, outfit.shirtColor);
  if (outfit.top === 'flannel_open') {
    const dk = darken(outfit.topColor, 0.55);
    for (const y of [0.53, 0.65]) {
      b.box(0.125, 0.025, 0.012, 0.125, y, 0.112, dk);
      b.box(0.125, 0.025, 0.012, -0.125, y, 0.112, dk);
    }
    b.box(0.025, 0.33, 0.012, 0.15, 0.47, 0.112, dk);
    b.box(0.025, 0.33, 0.012, -0.15, 0.47, 0.112, dk);
  }
  if (outfit.top === 'hoodie_open') b.box(0.3, 0.09, 0.08, 0, 0.74, -0.13, outfit.topColor); // hood
  if (outfit.top === 'puffer') b.box(0.42, 0.06, 0.24, 0, 0.6, 0, darken(outfit.topColor, 0.8));
  if (outfit.top === 'jersey') b.box(0.12, 0.12, 0.01, 0, 0.56, 0.111, '#ffffff');
  if (outfit.chain) b.box(0.15, 0.03, 0.01, 0, 0.69, 0.118, '#d8dbe2');
  if (outfit.chain && detail === 'leader') b.box(0.035, 0.035, 0.012, 0, 0.66, 0.119, '#eef0f5');
  if (outfit.pocketBandana) b.box(0.07, 0.13, 0.02, 0.07, 0.3, -0.085, outfit.hatColor === '#ffffff' ? '#e0202e' : outfit.hatColor);
  const shortSleeve = outfit.top === 'tee' || outfit.top === 'jersey' || outfit.top === 'flannel_open';
  arms(b, outfit.topColor, skin, shortSleeve, outfit.tattoos.includes('forearms') || outfit.tattoos.includes('hands'));
  head(b, skin, outfit, { tattoo: outfit.tattoos.includes('neck') });
  if (detail === 'leader') {
    // phone in hand for the lean pose silhouette
    b.box(0.05, 0.09, 0.015, 0.235, 0.43, 0.06, '#101015', 2);
  }
  return b.build();
}

/**
 * Low-detail LOD (~8 boxes) used beyond render.lodDistance. Keeps the same
 * silhouette, palette and limb codes so the run cycle and readability match.
 */
export function buildCharacterLow(outfit: Outfit, skin: string): THREE.BufferGeometry {
  const b = new Builder();
  for (const s of [1, -1] as const) b.box(0.15, 0.45, 0.16, 0.085 * s, 0, 0, outfit.pantsColor, s);
  b.box(0.38, 0.38, 0.22, 0, 0.42, 0, outfit.topColor);
  if (outfit.top === 'hoodie_open' || outfit.top === 'flannel_open') b.box(0.13, 0.36, 0.01, 0, 0.42, 0.111, outfit.shirtColor);
  for (const s of [1, -1] as const) b.box(0.11, 0.38, 0.12, 0.235 * s, 0.41, 0, outfit.topColor, (2 * s) as Limb);
  b.box(0.27, 0.3, 0.26, 0, 0.8, 0, skin);
  b.box(0.29, 0.08, 0.28, 0, 1.05, 0, outfit.hat === 'none' ? '#141010' : outfit.hatColor);
  return b.build();
}

export function buildCopLow(colors: { primary: string; secondary: string }, variant: 'patrol' | 'riot' | 'swat' | 'motor'): THREE.BufferGeometry {
  const b = new Builder();
  const navy = variant === 'swat' ? '#2a2f38' : colors.primary;
  for (const s of [1, -1] as const) b.box(0.15, 0.45, 0.16, 0.085 * s, 0, 0, darken(colors.primary, 0.8), s);
  b.box(0.38, 0.38, 0.22, 0, 0.42, 0, navy);
  for (const s of [1, -1] as const) b.box(0.11, 0.38, 0.12, 0.235 * s, 0.41, 0, navy, (2 * s) as Limb);
  b.box(0.27, 0.3, 0.26, 0, 0.8, 0, '#c68c63');
  b.box(0.3, 0.1, 0.29, 0, 1.03, 0, variant === 'patrol' ? colors.primary : variant === 'motor' ? '#f2f2f2' : '#1c2130');
  if (variant === 'riot') b.box(0.46, 0.66, 0.035, 0, 0.18, 0.24, '#9fb3cc');
  return b.build();
}

/** Police placeholder: navy uniform, cap, badge; riot variant gets helmet + shield. */
export function buildCop(colors: { primary: string; secondary: string }, variant: 'patrol' | 'riot' | 'swat' | 'motor'): THREE.BufferGeometry {
  const b = new Builder();
  const navy = colors.primary;
  const black = colors.secondary;
  legsAndShoes(b, darken(navy, 0.8).getStyle(), black, black);
  b.box(0.38, 0.35, 0.22, 0, 0.45, 0, variant === 'swat' ? '#2a2f38' : navy);
  b.box(0.39, 0.05, 0.225, 0, 0.45, 0, black); // belt
  b.box(0.06, 0.06, 0.01, -0.1, 0.68, 0.112, '#ffcc33'); // badge
  if (variant === 'swat') b.box(0.4, 0.22, 0.24, 0, 0.52, 0, '#1a1d22');
  arms(b, variant === 'swat' ? '#2a2f38' : navy, '#c68c63', false, false);
  b.box(0.1, 0.05, 0.1, 0, 0.79, 0, '#c68c63');
  b.box(0.27, 0.27, 0.26, 0, 0.83, 0, '#c68c63');
  b.box(0.24, 0.055, 0.03, 0, 0.92, 0.135, '#121418'); // shades
  if (variant === 'riot' || variant === 'swat' || variant === 'motor') {
    b.box(0.31, 0.2, 0.3, 0, 0.98, 0, variant === 'motor' ? '#f2f2f2' : '#1c2130');
    b.box(0.28, 0.12, 0.02, 0, 0.86, 0.16, '#5d7aa8');
  } else {
    b.box(0.3, 0.07, 0.29, 0, 1.06, 0, navy);
    b.box(0.26, 0.025, 0.12, 0, 1.06, 0.18, black);
    b.box(0.08, 0.04, 0.01, 0, 1.08, 0.146, '#ffcc33');
  }
  if (variant === 'riot') {
    b.box(0.46, 0.66, 0.035, 0, 0.18, 0.24, '#9fb3cc');
    b.box(0.4, 0.06, 0.04, 0, 0.62, 0.245, '#1c2130');
  }
  return b.build();
}

/** Big Sarge: hulking navy officer, mirrored aviators, riot helmet, oversized badge. Built at crew scale, scaled by config. */
export function buildBossCop(colors: { primary: string; secondary: string; lightRed: string; lightBlue: string }): { body: THREE.BufferGeometry; lightsRed: THREE.BufferGeometry; lightsBlue: THREE.BufferGeometry; shield: THREE.BufferGeometry; baton: THREE.BufferGeometry } {
  const b = new Builder();
  const navy = colors.primary;
  legsAndShoes(b, darken(navy, 0.75).getStyle(), '#0b0b0d', '#0b0b0d');
  b.box(0.5, 0.4, 0.3, 0, 0.44, 0, navy); // big chest
  b.box(0.54, 0.12, 0.32, 0, 0.72, 0, navy); // shoulders
  b.box(0.52, 0.06, 0.31, 0, 0.42, 0, '#0b0b0d');
  b.box(0.12, 0.1, 0.012, -0.13, 0.62, 0.156, '#ffcc33'); // oversized badge
  b.box(0.06, 0.04, 0.012, 0.13, 0.66, 0.156, '#c9ccd4');
  for (const s of [1, -1] as const) {
    b.box(0.15, 0.36, 0.16, 0.33 * s, 0.46, 0, navy, (2 * s) as Limb);
    b.box(0.12, 0.09, 0.12, 0.33 * s, 0.37, 0, '#c68c63', (2 * s) as Limb);
  }
  b.box(0.14, 0.05, 0.14, 0, 0.84, 0, '#c68c63');
  b.box(0.3, 0.27, 0.28, 0, 0.87, 0, '#c68c63');
  b.box(0.27, 0.07, 0.03, 0, 0.96, 0.145, '#d8e4f0'); // mirrored aviators
  b.box(0.2, 0.03, 0.02, 0, 0.9, 0.145, '#5a3a28'); // mustache
  b.box(0.34, 0.2, 0.33, 0, 1.03, 0, '#151a26'); // riot helmet
  b.box(0.32, 0.03, 0.12, 0, 1.03, 0.2, '#151a26');
  const red = new Builder().box(0.09, 0.05, 0.09, 0.27, 0.84, 0, colors.lightRed).build();
  const blue = new Builder().box(0.09, 0.05, 0.09, -0.27, 0.84, 0, colors.lightBlue).build();
  const shield = new Builder().box(0.62, 0.8, 0.04, 0, 0.12, 0.3, '#9fb3cc').box(0.5, 0.08, 0.05, 0, 0.66, 0.3, '#1c2130').build();
  const baton = new Builder().cyl(0.025, 0.03, 0.42, 0, 0, 0, '#111114').build();
  return { body: b.build(), lightsRed: red, lightsBlue: blue, shield, baton };
}

/**
 * Lambert material with a vertex-shader run cycle. Per-instance phase comes
 * from gl_InstanceID so the crowd never marches in lockstep.
 */
export function crowdMaterial(opts: { instanced: boolean }): THREE.MeshLambertMaterial & { userData: { uniforms: { uTime: { value: number }; uRun: { value: number } } } } {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true }) as THREE.MeshLambertMaterial & { userData: { uniforms: { uTime: { value: number }; uRun: { value: number } } } };
  const uniforms = { uTime: { value: 0 }, uRun: { value: 1 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uRun = uniforms.uRun;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aLimb;
uniform float uTime;
uniform float uRun;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
float ph = uTime * 11.0 + ${opts.instanced ? 'float(gl_InstanceID) * 2.399' : '0.0'};
float s = sin(ph);
float al = abs(aLimb);
float side = sign(aLimb);
float isLeg = step(0.5, al) * (1.0 - step(1.5, al));
float isArm = step(1.5, al);
float pivot = mix(${LEG_PIVOT.toFixed(3)}, ${ARM_PIVOT.toFixed(3)}, isArm);
float ang = (isLeg * 0.75 - isArm * 0.65) * s * side * uRun + isArm * (1.0 - uRun) * 0.08 * sin(uTime * 2.0 + side);
if (al > 0.5) {
  float yy = transformed.y - pivot;
  float zz = transformed.z;
  float c = cos(ang);
  float sn = sin(ang);
  transformed.y = pivot + yy * c - zz * sn;
  transformed.z = yy * sn + zz * c;
}
transformed.y += abs(cos(ph)) * 0.04 * uRun;`,
      );
  };
  return m;
}
