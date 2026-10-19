/**
 * Pooled effects. Every buffer is allocated once at the configured cap and
 * recycled ring-style, so heavy firefights never allocate per frame.
 */
import * as THREE from 'three';

export class Tracers {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private base: Float32Array;
  private next = 0;
  constructor(private max: number, private lifeSec: number, private width = 0.07) {
    // 4 verts per tracer: a flat ribbon that reads from the high 3/4 camera
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 12);
    this.life = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
  }
  spawn(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, color: THREE.Color): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const dx = tx - fx;
    const dy = ty - fy;
    const dz = tz - fz;
    // a streak covering the last ~60% of the path
    const sx = fx + dx * 0.4;
    const sy = fy + dy * 0.4;
    const sz = fz + dz * 0.4;
    const hl = Math.hypot(dx, dz) || 1;
    const px = (-dz / hl) * this.width;
    const pz = (dx / hl) * this.width;
    this.pos.set([sx - px, sy, sz - pz, sx + px, sy, sz + pz, tx - px, ty, tz - pz, tx + px, ty, tz + pz], i * 12);
    this.life[i] = this.lifeSec;
    color.toArray(this.base, i * 3);
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      let a = 0;
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        a = Math.max(0, this.life[i] / this.lifeSec);
      }
      const p = i * 12;
      const r = this.base[i * 3] * a;
      const g = this.base[i * 3 + 1] * a;
      const b = this.base[i * 3 + 2] * a;
      // tail dim, head bright
      for (let v = 0; v < 4; v++) {
        const k = v < 2 ? 0.25 : 1;
        this.col[p + v * 3] = r * k;
        this.col[p + v * 3 + 1] = g * k;
        this.col[p + v * 3 + 2] = b * k;
      }
    }
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export interface ParticleOpts {
  count: number;
  color: THREE.Color;
  speed: number;
  up?: number;
  size: number;
  life: number;
  gravity?: number;
  spread?: number;
  drag?: number;
  additive?: boolean;
}

/** One CPU-simulated point cloud with per-particle color/size/alpha. */
export class Particles {
  readonly mesh: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseSize: Float32Array;
  private next = 0;
  constructor(private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main() {
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.05, r));
        }`,
    });
    this.mesh = new THREE.Points(g, mat);
    this.mesh.frustumCulled = false;
  }
  setScale(px: number): void {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }
  burst(x: number, y: number, z: number, o: ParticleOpts): void {
    for (let n = 0; n < o.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const s = o.speed * (0.4 + Math.random() * 0.6);
      const sp = o.spread ?? 1;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.2 * sp;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2 * sp;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = (o.up ?? 0) * (0.5 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      o.color.toArray(this.col, i * 3);
      this.baseSize[i] = o.size * (0.7 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i] = o.life * (0.7 + Math.random() * 0.5);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 2;
    }
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = t;
      this.size[i] = this.baseSize[i] * (0.6 + 0.4 * t);
    }
    const a = this.mesh.geometry.attributes;
    (a.position as THREE.BufferAttribute).needsUpdate = true;
    (a.color as THREE.BufferAttribute).needsUpdate = true;
    (a.aSize as THREE.BufferAttribute).needsUpdate = true;
    (a.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
