/** Map scenery built once per level from the map theme + compiled layout. */
import * as THREE from 'three';
import type { MapDef } from '../schema/types';
import type { CompiledLevel } from '../sim/world';
import { asphaltTexture } from './textures';

export interface Environment {
  group: THREE.Group;
  update(t: number, cameraZ: number): void;
}

export function buildEnvironment(map: MapDef, level: CompiledLevel, roadWidth: number, wallHeight: number): Environment {
  const th = map.theme;
  const group = new THREE.Group();
  const half = roadWidth / 2;
  const z0 = -40;
  const z1 = level.length + 80;
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;

  // Road deck
  const tex = asphaltTexture(th.road);
  tex.repeat.set(2, len / 8);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth + 1.2, len), new THREE.MeshLambertMaterial({ map: tex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, zc);
  group.add(road);

  // Deck side / bridge girder
  const deckSide = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 2.4, 1.6, len), new THREE.MeshLambertMaterial({ color: '#8b8f96' }));
  deckSide.position.set(0, -0.82, zc);
  group.add(deckSide);

  // Lane dashes (instanced) — skip inside lane-wall segments where walls take over.
  const dashGeo = new THREE.BoxGeometry(0.14, 0.02, 2.2);
  const dashMat = new THREE.MeshBasicMaterial({ color: th.roadLine });
  const dashes: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  for (let z = z0; z < z1; z += 6) {
    const inWall = level.walls.some((w) => z >= w.z0 && z <= w.z1);
    if (inWall) continue;
    for (const x of [-half / 3, half / 3]) dashes.push(m.clone().makeTranslation(x, 0.01, z));
  }
  const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, Math.max(1, dashes.length));
  dashes.forEach((mm, i) => dashMesh.setMatrixAt(i, mm));
  dashMesh.count = dashes.length;
  group.add(dashMesh);
  // edge lines
  for (const s of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, len), new THREE.MeshBasicMaterial({ color: '#f5d33a' }));
    line.position.set(s * (half - 0.15), 0.012, zc);
    group.add(line);
  }

  // Edge barriers: concrete jersey barriers with hazard stripes, instanced.
  const barrierGeo = new THREE.BoxGeometry(0.55, 0.85, 3.9);
  barrierGeo.translate(0, 0.425, 0);
  const barrierMat = new THREE.MeshLambertMaterial({ color: '#c9c6bf' });
  const stripeGeo = new THREE.BoxGeometry(0.57, 0.12, 3.9);
  stripeGeo.translate(0, 0.66, 0);
  const stripeMat = new THREE.MeshLambertMaterial({ color: '#f2b705' });
  const nB = Math.ceil(len / 4) * 2;
  const barriers = new THREE.InstancedMesh(barrierGeo, barrierMat, nB);
  const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, nB);
  let bi = 0;
  for (let z = z0; z < z1 && bi < nB; z += 4)
    for (const s of [-1, 1]) {
      m.makeTranslation(s * (half + 0.35), 0, z);
      barriers.setMatrixAt(bi, m);
      stripes.setMatrixAt(bi, m);
      bi++;
    }
  group.add(barriers, stripes);

  // Light poles every ~24m alternating sides
  const poleMat = new THREE.MeshLambertMaterial({ color: '#7b8088' });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff4c8' });
  for (let z = z0 + 10, k = 0; z < z1; z += 24, k++) {
    const s = k % 2 === 0 ? -1 : 1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 6), poleMat);
    pole.position.set(s * (half + 0.9), 3, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), poleMat);
    arm.position.set(s * (half + 0.2), 5.95, z);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), lampMat);
    lamp.position.set(s * (half - 0.5), 5.88, z);
    group.add(pole, arm, lamp);
  }

  // Lane walls (low dividers) inside lane segments
  const wallMat = new THREE.MeshLambertMaterial({ color: '#d8d4cc' });
  const capMat = new THREE.MeshLambertMaterial({ color: '#2a6fd6' });
  for (const w of level.walls) {
    for (let i = 1; i < w.edges.length - 1; i++) {
      const l = w.z1 - w.z0;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, wallHeight, l), wallMat);
      wall.position.set(w.edges[i], wallHeight / 2, (w.z0 + w.z1) / 2);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, l), capMat);
      cap.position.set(w.edges[i], wallHeight + 0.04, (w.z0 + w.z1) / 2);
      group.add(wall, cap);
    }
  }

  // Finish line
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(0, 0.015, level.finishZ);
  if (!level.boss) group.add(finish);

  // Water / ground plane with gentle animated shimmer
  const waterMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(th.edgeColor) }, uDeep: { value: new THREE.Color(th.ground) }, uFog: { value: new THREE.Color(th.fog) }, uFogNear: { value: th.fogNear }, uFogFar: { value: th.fogFar } },
    vertexShader: `varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mv = viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform vec3 uDeep; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; varying vec3 vW; varying float vD;
      void main(){
        float w = sin(vW.x*0.35+uTime*1.3)*sin(vW.z*0.27-uTime*0.9);
        float sparkle = smoothstep(0.86,1.0, sin(vW.x*1.7+uTime*2.1)*sin(vW.z*1.3+uTime*1.7));
        vec3 c = mix(uDeep, uColor, 0.5+0.5*w) + sparkle*0.35;
        float f = smoothstep(uFogNear, uFogFar, vD);
        gl_FragColor = vec4(mix(c, uFog, f), 1.0);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, len + 400), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, th.edge === 'water' ? -3 : -0.05, zc);
  group.add(water);

  return {
    group,
    update(t) {
      waterMat.uniforms.uTime.value = t;
    },
  };
}
