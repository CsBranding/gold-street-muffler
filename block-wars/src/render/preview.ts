/**
 * Small standalone 3D stage for the select screens: one rigged leader on a
 * turntable playing their idle pose. Drag to spin. Owns its own WebGL
 * context and frees it on dispose().
 */
import * as THREE from 'three';
import { RiggedActor } from './crowds';
import { buildSkinnedMesh, idlePoseClips, type Look } from './rig';
import { stylizedMaterial } from './vat';

export class CharacterPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private actor: RiggedActor | null = null;
  private yaw = 0.35;
  private spin = 0.25;
  private raf = 0;
  private last = performance.now();
  private dragX: number | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#506070', 1.3));
    const key = new THREE.DirectionalLight('#fff2dc', 2.4);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight('#9fc8ff', 1.4);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera.position.set(0, 0.95, 3.6);
    this.camera.lookAt(0, 0.62, 0);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.dragX = e.clientX));
    window.addEventListener('pointerup', () => (this.dragX = null));
    el.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.yaw += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
      this.spin = 0;
    });
    this.resize();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.yaw += this.spin * dt;
      if (this.actor) {
        this.actor.mesh.rotation.y = this.yaw;
        this.actor.update(dt);
      }
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize(): void {
    const w = this.host.clientWidth || 300;
    const h = this.host.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  show(look: Look, pose: string, rim: string, dim = false): void {
    if (this.actor) {
      this.scene.remove(this.actor.mesh);
      this.actor.mesh.geometry.dispose();
    }
    const mat = stylizedMaterial({ rim, rimStrength: 0.7 });
    if (dim) mat.color.setRGB(0.25, 0.25, 0.28);
    const mesh = buildSkinnedMesh(look, 'hi', mat);
    this.scene.add(mesh);
    this.actor = new RiggedActor(mesh, idlePoseClips());
    this.actor.play(pose, 0);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
