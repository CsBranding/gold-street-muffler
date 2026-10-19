/** Low-poly obstacle props. Built at runtime; swapped for real art via assets.json. */
import * as THREE from 'three';
import type { ObstacleRT } from '../sim/world';
import { toonGradient } from './vat';

const lam = (c: string) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
const M = {
  wood: lam('#a0602e'),
  woodDark: lam('#6e3d1a'),
  band: lam('#7c8189'),
  green: lam('#2f6b45'),
  greenDark: lam('#214d31'),
  black: lam('#121317'),
  white: lam('#f0f0f0'),
  glass: lam('#2b3a4f'),
  // over-bright so the bloom pass makes the light bars glow
  red: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a3a').multiplyScalar(3) }),
  blue: new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a7bff').multiplyScalar(3) }),
  metal: lam('#9aa0a8'),
};

export function buildProp(o: ObstacleRT, factionColor: string): THREE.Group {
  const g = new THREE.Group();
  const w = o.halfW * 2;
  switch (o.kind) {
    case 'barrel': {
      // barrels lie on their side like a roadblock row
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, w, 14), M.wood);
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.55;
      g.add(body);
      for (const x of [-w * 0.32, w * 0.32]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.08, 14), M.band);
        band.rotation.z = Math.PI / 2;
        band.position.set(x, 0.55, 0);
        g.add(band);
      }
      break;
    }
    case 'crate': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 1.1), M.wood);
      box.position.y = 0.55;
      g.add(box);
      for (const y of [0.1, 1.0]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.12, 1.14), M.woodDark);
        slat.position.y = y;
        g.add(slat);
      }
      break;
    }
    case 'dumpster': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 1.3), M.green);
      box.position.y = 0.6;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.1, 1.36), M.greenDark);
      lid.position.y = 1.22;
      g.add(box, lid);
      break;
    }
    case 'cruiser': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, 1.5), M.black);
      body.position.y = 0.45;
      const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.42, 1.52), M.white);
      door.position.y = 0.48;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.45, 1.3), M.glass);
      cab.position.y = 0.97;
      const barR = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.12, 0.3), M.red);
      barR.position.set(-w * 0.1, 1.25, 0);
      const barB = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.12, 0.3), M.blue);
      barB.position.set(w * 0.1, 1.25, 0);
      barR.name = 'lightR';
      barB.name = 'lightB';
      g.add(body, door, cab, barR, barB);
      for (const x of [-w * 0.35, w * 0.35])
        for (const z of [-0.5, 0.5]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10), M.black);
          wheel.rotation.x = Math.PI / 2;
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.22, z * 1.55);
          g.add(wheel);
        }
      break;
    }
    case 'barricade': {
      // plank gate between steel posts, number painted on the boards (DOM label)
      const boards = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 1.0, 0.25), M.wood);
      boards.position.y = 0.6;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w - 0.25, 0.1, 0.28), M.band);
      trim.position.y = 1.12;
      const trim2 = trim.clone();
      trim2.position.y = 0.12;
      g.add(boards, trim, trim2);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.4, 0.36), M.metal);
        post.position.set(s * (w / 2 - 0.11), 0.7, 0);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 6), M.metal);
        spike.position.set(s * (w / 2 - 0.11), 1.52, 0);
        g.add(post, spike);
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.08, 0.26), lam(factionColor));
      stripe.position.y = 0.95;
      g.add(stripe);
      break;
    }
  }
  g.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
  });
  g.position.set(o.x, 0, o.z);
  return g;
}
