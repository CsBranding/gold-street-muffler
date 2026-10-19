/**
 * Map-specific set dressing, all procedural low-poly:
 *  - Hood Block (art direction: the reference image): golden-hour street,
 *    cracked sidewalks, corner stores with barred windows, chain-link fences,
 *    palm trees, power poles with sagging lines, old parked sedans.
 *  - Harbor Pier: plank edge + bollards over water, stacked shipping
 *    containers, gantry cranes.
 * Store signs use generic words only.
 */
import * as THREE from 'three';
import { asphaltTexture, DISPLAY_FONT } from './textures';
import { toonGradient } from './vat';

const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

/** deterministic per-map randomness so scenery doesn't reshuffle between runs */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], shadow = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
  mesh.count = mats.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

function signTexture(word: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 64);
  g.font = `44px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = '#00000088';
  g.strokeText(word, 128, 34);
  g.fillStyle = fg;
  g.fillText(word, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let fenceTex: THREE.CanvasTexture | null = null;
function chainLinkTexture(): THREE.CanvasTexture {
  if (fenceTex) return fenceTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(200,205,210,0.9)';
  g.lineWidth = 2;
  for (let i = -64; i < 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.stroke();
    g.beginPath();
    g.moveTo(i + 64, 0);
    g.lineTo(i, 64);
    g.stroke();
  }
  fenceTex = new THREE.CanvasTexture(c);
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
  return fenceTex;
}

function sedan(color: string, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const body = toon(color);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 4.2), body);
  lower.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.1), body);
  cabin.position.set(0, 1.07, -0.2);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.36, 2.0), toon('#2a3442'));
  glass.position.set(0, 1.08, -0.2);
  const chrome = toon('#c9ccd4');
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.14, 0.12), chrome);
  bumper.position.set(0, 0.4, 2.12);
  const bumper2 = bumper.clone();
  bumper2.position.z = -2.12;
  g.add(lower, cabin, glass, bumper, bumper2);
  for (const [x, z] of [[0.8, 1.3], [-0.8, 1.3], [0.8, -1.3], [-0.8, -1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12), toon('#141414'));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  g.rotation.y = (r() - 0.5) * 0.08;
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o.castShadow = true), (o.receiveShadow = true)) : null));
  return g;
}

// ------------------------------------------------------------------ hood
export function buildHoodBlock(group: THREE.Group, z0: number, z1: number, half: number, seed: number): void {
  const r = rng(seed);
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const walkW = 3.4;

  // sidewalks + curbs
  const walkTex = asphaltTexture('#b9b0a2');
  walkTex.repeat.set(1, len / 6);
  for (const s of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(walkW, 0.18, len), toon('#ffffff', { map: walkTex }));
    walk.position.set(s * (half + walkW / 2 + 0.15), 0.09, zc);
    walk.receiveShadow = true;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, len), toon('#d8d0c2'));
    curb.position.set(s * (half + 0.15), 0.11, zc);
    // red curb paint near hydrants, like the reference
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.06, 6), toon('#b8332b'));
    red.position.set(s * (half + 0.15), 0.23, z0 + r() * len);
    group.add(walk, curb, red);
  }
  // expansion joints across the sidewalk (instanced dark lines)
  const joint: THREE.Matrix4[] = [];
  for (let z = z0; z < z1; z += 2.2) for (const s of [-1, 1]) joint.push(new THREE.Matrix4().makeTranslation(s * (half + walkW / 2 + 0.15), 0.185, z));
  group.add(instanced(new THREE.BoxGeometry(walkW, 0.01, 0.05), toon('#7d756a'), joint, false));
  // dirt lots behind the sidewalks
  for (const s of [-1, 1]) {
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(60, len + 120), toon('#9a8a72'));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(s * (half + walkW + 30), 0.02, zc);
    lot.receiveShadow = true;
    group.add(lot);
  }

  // corner stores and fenced lots alternate down each side
  const storeColors = ['#c9b48a', '#a9a07a', '#b88f6a', '#9fa58c', '#c4a37c'];
  const words = ['MARKET', 'LIQUOR', 'DELI', 'TIRES', 'CHECKS', 'WINGS', 'LAUNDRY'];
  const barGeo = new THREE.BoxGeometry(0.05, 1.5, 0.05);
  const bars: THREE.Matrix4[] = [];
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6);
  const posts: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    let z = z0 + r() * 10;
    while (z < z1) {
      const x0 = s * (half + walkW + 0.4);
      if (r() < 0.6) {
        const w = 10 + r() * 8;
        const d = 8 + r() * 4;
        const h = 3.6 + r() * 1.4;
        const color = storeColors[Math.floor(r() * storeColors.length)];
        const bld = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), toon(color));
        bld.position.set(x0 + (s * d) / 2, h / 2, z + w / 2);
        bld.castShadow = bld.receiveShadow = true;
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(d + 0.2, 0.4, w + 0.2), toon(new THREE.Color(color).multiplyScalar(0.8).getStyle()));
        parapet.position.set(bld.position.x, h + 0.2, bld.position.z);
        // storefront: dark glass, roll-up door, awning band, sign
        const face = x0 + s * -0.02;
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, 1.6), toon('#1c232c'));
        glass.position.set(face, 1.35, z + w * 0.35);
        glass.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        for (let b = 0; b < 12; b++) bars.push(new THREE.Matrix4().makeTranslation(face - s * 0.04, 1.35, z + w * 0.35 - w * 0.27 + (b / 11) * w * 0.54));
        const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.4), toon('#7d8288'));
        door.position.set(face, 1.2, z + w * 0.78);
        door.rotation.y = glass.rotation.y;
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, w), toon('#2f6f8f'));
        band.position.set(face - s * 0.15, 2.65, z + w / 2);
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.min(6, w * 0.5), 1.1),
          new THREE.MeshBasicMaterial({ map: signTexture(words[Math.floor(r() * words.length)], r() < 0.5 ? '#f2efe6' : '#d9c24a', r() < 0.5 ? '#c4121f' : '#1d6a35') }),
        );
        sign.position.set(face - s * 0.05, 3.35, z + w / 2);
        sign.rotation.y = glass.rotation.y;
        group.add(bld, parapet, glass, door, band, sign);
        z += w + 2 + r() * 6;
      } else {
        // empty lot behind chain-link
        const w = 8 + r() * 8;
        const map = chainLinkTexture().clone();
        map.repeat.set(w / 1.2, 2);
        const fence = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
        fence.position.set(x0 + s * 0.3, 1.1, z + w / 2);
        fence.rotation.y = Math.PI / 2;
        group.add(fence);
        for (let p = 0; p <= w; p += 2.5) posts.push(new THREE.Matrix4().makeTranslation(x0 + s * 0.3, 1.2, z + p));
        z += w + 1;
      }
    }
  }
  group.add(instanced(barGeo, toon('#3a3d42'), bars, false), instanced(postGeo, toon('#9aa0a8'), posts));

  // palm trees: tall leaning trunks, crown of fronds
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const frondGeo = new THREE.ConeGeometry(0.45, 3.2, 4);
  frondGeo.translate(0, 1.6, 0);
  frondGeo.rotateZ(Math.PI / 2 - 0.35);
  const trunks: THREE.Matrix4[] = [];
  const fronds: THREE.Matrix4[] = [];
  for (let z = z0 + 6; z < z1 + 60; z += 9 + r() * 14) {
    const s = r() < 0.5 ? -1 : 1;
    const x = s * (half + walkW + 2 + r() * 22);
    const h = 9 + r() * 7;
    const lean = (r() - 0.5) * 0.18;
    q.setFromEuler(new THREE.Euler(lean, 0, (r() - 0.5) * 0.15));
    trunks.push(new THREE.Matrix4().compose(v.set(x, 0, z), q, sc.set(1, h, 1)));
    const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
    for (let f = 0; f < 8; f++) {
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (f / 8) * Math.PI * 2 + r(), 0));
      fronds.push(new THREE.Matrix4().compose(top, qq, sc.set(1, 1, 0.35)));
    }
  }
  group.add(instanced(trunkGeo, toon('#7a5a3a'), trunks), instanced(frondGeo, toon('#3f6b2e'), fronds));

  // power poles with crossarms and sagging lines (both sides)
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 6);
  poleGeo.translate(0, 4.5, 0);
  const armGeo = new THREE.BoxGeometry(2.2, 0.12, 0.12);
  const poles: THREE.Matrix4[] = [];
  const arms: THREE.Matrix4[] = [];
  const lineMat = toon('#1a1a1a');
  for (const s of [-1, 1]) {
    const x = s * (half + walkW - 0.4);
    let prev: THREE.Vector3 | null = null;
    for (let z = z0; z < z1 + 40; z += 28) {
      poles.push(new THREE.Matrix4().makeTranslation(x, 0, z));
      arms.push(new THREE.Matrix4().makeTranslation(x, 8.4, z));
      const top = new THREE.Vector3(x, 8.4, z);
      if (prev)
        for (const dx of [-0.9, 0, 0.9]) {
          const a = prev.clone().add(new THREE.Vector3(dx, 0, 0));
          const b = top.clone().add(new THREE.Vector3(dx, 0, 0));
          const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.9, 0));
          group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 10, 0.025, 3), lineMat));
        }
      prev = top;
    }
  }
  group.add(instanced(poleGeo, toon('#5a4632'), poles), instanced(armGeo, toon('#5a4632'), arms));

  // old sedans parked along the curb
  const carColors = ['#8a8f96', '#6d5a48', '#a39a8a', '#5d6670', '#7a3b33', '#b8b2a6'];
  for (let z = z0 + 10; z < z1; z += 14 + r() * 16) {
    const s = r() < 0.5 ? -1 : 1;
    const car = sedan(carColors[Math.floor(r() * carColors.length)], r);
    car.position.set(s * (half + walkW + 3), 0.02, z);
    group.add(car);
  }
}

// ---------------------------------------------------------------- harbor
export function buildHarbor(group: THREE.Group, z0: number, z1: number, half: number, seed: number): void {
  const r = rng(seed);
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;

  // plank strips + bollards along both edges, pier piles below
  const plankMat = toon('#8a6a48');
  for (const s of [-1, 1]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, len), plankMat);
    deck.position.set(s * (half + 2.5), -0.1, zc);
    deck.receiveShadow = true;
    group.add(deck);
  }
  const plankLines: THREE.Matrix4[] = [];
  for (let z = z0; z < z1; z += 0.6) for (const s of [-1, 1]) plankLines.push(new THREE.Matrix4().makeTranslation(s * (half + 2.5), 0.055, z));
  group.add(instanced(new THREE.BoxGeometry(5, 0.01, 0.04), toon('#5e452c'), plankLines, false));
  const bollardGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.6, 8);
  bollardGeo.translate(0, 0.3, 0);
  const bollards: THREE.Matrix4[] = [];
  const piles: THREE.Matrix4[] = [];
  for (let z = z0; z < z1; z += 6)
    for (const s of [-1, 1]) {
      bollards.push(new THREE.Matrix4().makeTranslation(s * (half + 0.4), 0, z));
      piles.push(new THREE.Matrix4().makeTranslation(s * (half + 4.6), -2.2, z));
    }
  group.add(instanced(bollardGeo, toon('#2c2f35'), bollards), instanced(new THREE.CylinderGeometry(0.25, 0.25, 4, 6), toon('#4a3a2a'), piles, false));

  // shipping container stacks
  const cGeo = new THREE.BoxGeometry(2.4, 2.6, 6);
  cGeo.translate(0, 1.3, 0);
  const ribGeo = new THREE.BoxGeometry(2.45, 2.5, 0.08);
  ribGeo.translate(0, 1.3, 0);
  const colors = ['#b8332b', '#2a5fa8', '#2f7a45', '#d9822b', '#6b6f78', '#c9a227'];
  const byColor = new Map<string, THREE.Matrix4[]>();
  const ribs: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    for (let z = z0 - 10; z < z1 + 40; z += 6.4) {
      if (r() < 0.18) continue;
      const rowX = s * (half + 6.5 + Math.floor(r() * 3) * 2.6);
      const stack = 1 + Math.floor(r() * 3);
      for (let k = 0; k < stack; k++) {
        const c = colors[Math.floor(r() * colors.length)];
        const mm = new THREE.Matrix4().makeTranslation(rowX, k * 2.62, z);
        (byColor.get(c) ?? byColor.set(c, []).get(c)!).push(mm);
        for (let rr = -2.5; rr <= 2.5; rr += 1.25) ribs.push(new THREE.Matrix4().makeTranslation(rowX, k * 2.62, z + rr));
      }
    }
  }
  for (const [c, mats] of byColor) group.add(instanced(cGeo, toon(c), mats));
  group.add(instanced(ribGeo, toon('#000000', { transparent: true, opacity: 0.18 }), ribs, false));

  // gantry cranes straddling the container rows
  const craneMat = toon('#e0b020');
  for (let z = z0 + 40; z < z1 + 40; z += 75) {
    const s = r() < 0.5 ? -1 : 1;
    const cx = s * (half + 10);
    for (const dz of [-3, 3])
      for (const dx of [-5, 5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 18, 0.6), craneMat);
        leg.position.set(cx + dx, 9, z + dz);
        leg.castShadow = true;
        group.add(leg);
      }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(11, 1.2, 7), craneMat);
    beam.position.set(cx, 18.6, z);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(26, 0.8, 1.2), craneMat);
    boom.position.set(cx - s * 9, 19.6, z);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), toon('#d9d4c4'));
    cab.position.set(cx, 17.2, z);
    group.add(beam, boom, cab);
  }
}
