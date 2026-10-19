/** Map scenery built once per level from the map theme + compiled layout. */
import * as THREE from 'three';
import type { MapDef } from '../schema/types';
import type { CompiledLevel } from '../sim/world';
import { buildHarbor, buildHoodBlock } from './scenery';
import { asphaltTexture } from './textures';
import { toonGradient } from './vat';

const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

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
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth + 1.2, len), toon('#ffffff', { map: tex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, zc);
  road.receiveShadow = true;
  group.add(road);

  // Deck side / bridge girder
  const bridge = th.edge === 'water';
  if (bridge || th.edge === 'pier') {
    const deckSide = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 2.4, 1.6, len), toon(bridge ? '#8b8f96' : '#5e5a55'));
    deckSide.position.set(0, -0.82, zc);
    group.add(deckSide);
  }

  // Lane dashes (instanced) — skip inside lane-wall segments where walls take over.
  const dashGeo = new THREE.BoxGeometry(0.14, 0.02, 2.2);
  const dashMat = toon(th.roadLine);
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
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, len), toon('#f5d33a'));
    line.position.set(s * (half - 0.15), 0.012, zc);
    group.add(line);
  }

  // Edge barriers: concrete jersey barriers with hazard stripes, instanced.
  const barrierGeo = new THREE.BoxGeometry(0.55, 0.85, 3.9);
  barrierGeo.translate(0, 0.425, 0);
  const barrierMat = toon('#d9d5cc');
  const stripeGeo = new THREE.BoxGeometry(0.57, 0.12, 3.9);
  stripeGeo.translate(0, 0.66, 0);
  const stripeMat = toon('#f2b705');
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
  barriers.receiveShadow = true;
  if (bridge) group.add(barriers, stripes);

  // Light poles every ~24m alternating sides
  const poleMat = toon('#7b8088');
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff4c8' });
  for (let z = z0 + 10, k = 0; bridge && z < z1; z += 24, k++) {
    const s = k % 2 === 0 ? -1 : 1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 6), poleMat);
    pole.position.set(s * (half + 0.9), 3, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), poleMat);
    arm.position.set(s * (half + 0.2), 5.95, z);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), lampMat);
    lamp.position.set(s * (half - 0.5), 5.88, z);
    pole.castShadow = true;
    group.add(pole, arm, lamp);
  }

  // Lane walls (low dividers) inside lane segments
  const wallMat = toon('#e2ded6');
  const capMat = toon('#2a6fd6');
  for (const w of level.walls) {
    for (let i = 1; i < w.edges.length - 1; i++) {
      const l = w.z1 - w.z0;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, wallHeight, l), wallMat);
      wall.position.set(w.edges[i], wallHeight / 2, (w.z0 + w.z1) / 2);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, l), capMat);
      cap.position.set(w.edges[i], wallHeight + 0.04, (w.z0 + w.z1) / 2);
      wall.castShadow = wall.receiveShadow = true;
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
        vec3 c = mix(uDeep, uColor, 0.5+0.5*w) + sparkle*0.45;
        // warm sun glints toward the horizon
        c += vec3(1.0,0.75,0.45) * smoothstep(0.55,1.0,w) * smoothstep(60.0,160.0,vD) * 0.25;
        float f = smoothstep(uFogNear, uFogFar, vD);
        gl_FragColor = vec4(mix(c, uFog, f), 1.0);
      }`,
  });
  const onLand = th.edge === 'sidewalk' || th.edge === 'gravel';
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, len + 400), onLand ? toon(th.ground) : waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, onLand ? -0.05 : th.edge === 'water' ? -3 : -2.2, zc);
  water.receiveShadow = onLand;
  group.add(water);
  const half0 = roadWidth / 2;
  if (th.edge === 'sidewalk') buildHoodBlock(group, z0, z1, half0, Math.round(level.length));
  if (th.edge === 'pier') buildHarbor(group, z0, z1, half0, Math.round(level.length));

  // ---- sky dome: zenith → horizon gradient with a hazy sun
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTop: { value: new THREE.Color(th.sky) }, uHorizon: { value: new THREE.Color(th.fog) }, uSun: { value: new THREE.Color(th.sun) }, uSunDir: { value: new THREE.Vector3(-0.35, 0.18, 1).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uTop, pow(h, 0.55));
        float sd = max(dot(normalize(vDir), uSunDir), 0.0);
        c += uSun * (pow(sd, 400.0) * 1.6 + pow(sd, 12.0) * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 12), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- distant skyline silhouettes (fog does the atmospheric fade)
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  const nBld = 90;
  const skyline = new THREE.InstancedMesh(bGeo, toon(th.edge === 'water' ? '#5d7590' : '#6b6670'), nBld);
  for (let i = 0; i < nBld; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const hgt = 12 + Math.pow(Math.random(), 2) * 55;
    m.compose(
      new THREE.Vector3(side * (110 + Math.random() * 70), -3, z0 + Math.random() * len + 60),
      new THREE.Quaternion(),
      new THREE.Vector3(8 + Math.random() * 14, hgt, 8 + Math.random() * 14),
    );
    skyline.setMatrixAt(i, m);
  }
  group.add(skyline);

  // ---- suspension bridge: towers, catenary main cables, suspenders
  if (th.edge === 'water') {
    const towerMat = toon('#c9503c');
    const span = 140;
    const towerH = 26;
    const towers: number[] = [];
    for (let z = z0 + 30; z < z1; z += span) towers.push(z);
    for (const tz of towers) {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.1, towerH, 1.4), towerMat);
        leg.position.set(sx * (half + 2.6), towerH / 2 - 1, tz);
        leg.castShadow = true;
        group.add(leg);
      }
      for (const y of [towerH * 0.55, towerH - 2]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 6.4, 1.0, 1.2), towerMat);
        beam.position.set(0, y, tz);
        group.add(beam);
      }
    }
    const cableMat = toon('#b8483a');
    const suspGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4);
    suspGeo.translate(0, 0.5, 0);
    const susp: THREE.Matrix4[] = [];
    for (let i = 0; i + 1 < towers.length + 1; i++) {
      const za = towers[i] ?? towers[towers.length - 1];
      const zb = towers[i + 1] ?? za + span;
      for (const sx of [-1, 1]) {
        const x = sx * (half + 2.6);
        const pts: THREE.Vector3[] = [];
        for (let k2 = 0; k2 <= 24; k2++) {
          const t = k2 / 24;
          const y = towerH - 2 - Math.sin(Math.PI * t) * (towerH - 5);
          pts.push(new THREE.Vector3(x, y, za + (zb - za) * t));
          if (k2 > 0 && k2 < 24 && k2 % 2 === 0) susp.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.8, za + (zb - za) * t), new THREE.Quaternion(), new THREE.Vector3(1, y - 0.8, 1)));
        }
        group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.16, 5), cableMat));
      }
    }
    const suspMesh = new THREE.InstancedMesh(suspGeo, cableMat, susp.length);
    susp.forEach((mm, i) => suspMesh.setMatrixAt(i, mm));
    group.add(suspMesh);
  }

  return {
    group,
    update(t, camZ) {
      sky.position.set(0, 0, camZ);
      waterMat.uniforms.uTime.value = t;
    },
  };
}
