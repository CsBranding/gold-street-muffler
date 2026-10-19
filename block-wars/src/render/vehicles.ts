/** Low-poly ride-on vehicles for pickups: a hopping lowrider and a dirt bike. */
import * as THREE from 'three';
import { toonGradient } from './vat';

const toon = (c: string) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });

function wheel(r: number, w: number, rim: string): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), toon('#121214'));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 1.05, 14), new THREE.MeshStandardMaterial({ color: rim, metalness: 1, roughness: 0.25 }));
  tire.rotation.z = hub.rotation.z = Math.PI / 2;
  g.add(tire, hub);
  return g;
}

export function buildLowrider(paint: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const p = toon(paint);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 2.3), p);
  lower.position.y = 0.32;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.8), p);
  hood.position.set(0, 0.5, 0.7);
  const trunk = hood.clone();
  trunk.position.z = -0.75;
  const chrome = new THREE.MeshStandardMaterial({ color: '#e6e8ee', metalness: 1, roughness: 0.2 });
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.08), chrome);
  bumperF.position.set(0, 0.26, 1.17);
  const bumperB = bumperF.clone();
  bumperB.position.z = -1.17;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.03, 2.1), chrome);
  trim.position.y = 0.4;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.7), toon('#f2efe6'));
  seat.position.set(0, 0.47, -0.1);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 0.03), new THREE.MeshStandardMaterial({ color: '#9ad4ff', transparent: true, opacity: 0.45, roughness: 0.1 }));
  wind.position.set(0, 0.62, 0.32);
  wind.rotation.x = -0.4;
  const lightL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4c0').multiplyScalar(2.5) }));
  lightL.position.set(0.32, 0.35, 1.16);
  const lightR = lightL.clone();
  lightR.position.x = -0.32;
  body.add(lower, hood, trunk, bumperF, bumperB, trim, seat, wind, lightL, lightR);
  body.name = 'body';
  g.add(body);
  for (const [x, z] of [[0.48, 0.75], [-0.48, 0.75], [0.48, -0.75], [-0.48, -0.75]]) {
    const w = wheel(0.2, 0.16, '#d9b23a');
    w.position.set(x, 0.2, z);
    w.name = 'wheel';
    g.add(w);
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return g;
}

export function buildDirtBike(paint: string): THREE.Group {
  const g = new THREE.Group();
  const p = toon(paint);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.9), p);
  frame.position.y = 0.52;
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.34), p);
  tank.position.set(0, 0.66, 0.18);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.42), toon('#151518'));
  seat.position.set(0, 0.66, -0.2);
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), toon('#c9ccd4'));
  fork.position.set(0, 0.5, 0.52);
  fork.rotation.x = 0.35;
  const bars = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.04), toon('#111'));
  bars.position.set(0, 0.78, 0.45);
  g.add(frame, tank, seat, fork, bars);
  for (const z of [0.62, -0.5]) {
    const w = wheel(0.27, 0.1, '#9aa0a8');
    w.position.set(0, 0.27, z);
    w.name = 'wheel';
    g.add(w);
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return g;
}
