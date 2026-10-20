/** Dev-only lineup of every character look (`?viewer`): rigged actors in front, VAT crowd copies behind. */
import * as THREE from 'three';
import type { GameConfig } from '../schema/types';
import { RiggedActor } from '../render/crowds';
import { bakeKayKitVat, kayKitActor, kayKitProp, specFromLook } from '../render/kaykit';
import { copLook, lookFromOutfit, type Look } from '../render/rig';
import { setAnim, stylizedMaterial, vatInstanced } from '../render/vat';

export function runViewer(root: HTMLElement, cfg: GameConfig, clip: string): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.game.render.exposure;
  renderer.shadowMap.enabled = true;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9cc7ef');
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#4a4a4a', 1.0));
  const sun = new THREE.DirectionalLight('#fff2d6', 2.6);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshToonMaterial({ color: '#5b5f66' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const pol = cfg.factions.police.colors;
  const looks: Look[] = [
    ...cfg.characters.characters.map((c) => lookFromOutfit(c.outfit, c.skinTone)),
    copLook(pol, 'patrol'),
    copLook(pol, 'riot'),
    copLook(pol, 'swat'),
    copLook(pol, 'boss'),
  ];
  const actors: RiggedActor[] = [];
  const t0 = performance.now();
  looks.forEach((look, i) => {
    const spec = specFromLook(look);
    const x = (i - (looks.length - 1) / 2) * 0.9;
    const a = kayKitActor(spec, stylizedMaterial({ rim: look.topColor, rimStrength: 0.5 }));
    a.object.position.set(x, 0, 1.2);
    scene.add(a.object);
    const act = new RiggedActor(a.object as never, a.clips);
    act.play(clip, 0);
    actors.push(act);
    const vat = bakeKayKitVat(spec);
    const mat = stylizedMaterial({ vat, rim: look.topColor, rimStrength: 0.45 });
    const inst = vatInstanced(vat, mat, 3);
    for (let k = 0; k < 3; k++) {
      inst.setMatrixAt(k, new THREE.Matrix4().makeTranslation(x + (k - 1) * 0.28, 0, -0.6 - k * 0.5));
      setAnim(inst, k, vat.clips[clip === 'idle' ? 'aim' : clip] ?? vat.clips.run, -k * 0.2);
    }
    inst.count = 3;
    (mat.userData.uniforms as { uTime: { value: number } }).uTime.value = 0;
    scene.add(inst);
    (inst.userData as { mat: typeof mat }).mat = mat;
  });
  console.log('bake ms', (performance.now() - t0).toFixed(0));
  const car = kayKitProp('car_police');
  if (car) {
    car.position.set(-4.5, 0, -3);
    car.scale.setScalar(0.9);
    scene.add(car);
  }
  const bld = kayKitProp('building_C');
  if (bld) {
    bld.position.set(4.5, 0, -6);
    scene.add(bld);
  }
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 2.4, 7.5);
  camera.lookAt(0, 0.6, 0);
  const clock = new THREE.Clock();
  const tick = () => {
    const dt = clock.getDelta();
    for (const a of actors) a.update(dt);
    scene.traverse((o) => {
      const m = (o.userData as { mat?: { userData: { uniforms: { uTime: { value: number } } } } }).mat;
      if (m) m.userData.uniforms.uTime.value = clock.elapsedTime;
    });
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}
