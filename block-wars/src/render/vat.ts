/**
 * Vertex Animation Textures. Skeletal clips are sampled once on the CPU and
 * every skinned vertex position/normal is written into float textures
 * (one block of rows per frame). An InstancedMesh then plays any clip per
 * instance in the vertex shader — 1,000+ fully animated characters for the
 * cost of a static mesh. Per-instance `aAnim` = (startFrame, frames,
 * startTime, fps); negative fps plays once and holds the last frame.
 */
import * as THREE from 'three';
import { buildHumanoidGeometry, buildSkeleton, type Look } from './rig';

export interface VatClip {
  start: number;
  frames: number;
  fps: number;
  loop: boolean;
  duration: number;
}

export interface VatAsset {
  geometry: THREE.BufferGeometry;
  pos: THREE.DataTexture;
  nrm: THREE.DataTexture;
  width: number;
  rowsPerFrame: number;
  clips: Record<string, VatClip>;
}

const MAX_W = 1024;

export function bakeVat(look: Look, detail: 'hi' | 'lo' | 'far', clips: { clip: THREE.AnimationClip; fps: number; loop: boolean }[]): VatAsset {
  const geometry = buildHumanoidGeometry(look, detail);
  const { root, skeleton } = buildSkeleton();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(root);
  mesh.bind(skeleton);
  const mixer = new THREE.AnimationMixer(mesh);

  const V = geometry.attributes.position.count;
  const width = Math.min(MAX_W, V);
  const rowsPerFrame = Math.ceil(V / width);
  const info: Record<string, VatClip> = {};
  let total = 0;
  for (const c of clips) {
    const frames = c.loop ? Math.max(2, Math.round(c.clip.duration * c.fps)) : Math.max(2, Math.round(c.clip.duration * c.fps) + 1);
    info[c.clip.name] = { start: total, frames, fps: c.fps, loop: c.loop, duration: c.clip.duration };
    total += frames;
  }
  const height = total * rowsPerFrame;
  const posData = new Uint16Array(width * height * 4);
  const nrmData = new Uint16Array(width * height * 4);
  const bindPos = geometry.attributes.position as THREE.BufferAttribute;
  const bindNrm = geometry.attributes.normal as THREE.BufferAttribute;
  const skinIdx = geometry.attributes.skinIndex as THREE.BufferAttribute;
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const toHalf = THREE.DataUtils.toHalfFloat;

  for (const c of clips) {
    const ci = info[c.clip.name];
    const action = mixer.clipAction(c.clip);
    action.play();
    for (let f = 0; f < ci.frames; f++) {
      const t = c.loop ? (f / ci.frames) * c.clip.duration : Math.min(c.clip.duration, f / c.fps);
      mixer.setTime(t);
      mesh.updateMatrixWorld(true);
      skeleton.update();
      const bm = skeleton.boneMatrices;
      for (let v = 0; v < V; v++) {
        const bi = skinIdx.getX(v);
        m.fromArray(bm, bi * 16);
        nm.getNormalMatrix(m);
        p.fromBufferAttribute(bindPos, v).applyMatrix4(m);
        n.fromBufferAttribute(bindNrm, v).applyMatrix3(nm).normalize();
        const row = (ci.start + f) * rowsPerFrame + Math.floor(v / width);
        const o = (row * width + (v % width)) * 4;
        posData[o] = toHalf(p.x);
        posData[o + 1] = toHalf(p.y);
        posData[o + 2] = toHalf(p.z);
        posData[o + 3] = toHalf(1);
        nrmData[o] = toHalf(n.x);
        nrmData[o + 1] = toHalf(n.y);
        nrmData[o + 2] = toHalf(n.z);
        nrmData[o + 3] = toHalf(0);
      }
    }
    action.stop();
    mixer.uncacheAction(c.clip);
  }
  const tex = (data: Uint16Array) => {
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  // drop skinning attributes: the shader reads the textures instead
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  return { geometry, pos: tex(posData), nrm: tex(nrmData), width, rowsPerFrame, clips: info };
}

let gradient: THREE.DataTexture | null = null;
/** 4-step toon ramp shared by every stylized material. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const d = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 220, 220, 220, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface StylizedUniforms {
  uTime: { value: number };
  uRim: { value: THREE.Color };
}

/** Toon + rim light; optionally reads a VAT for the vertex animation. */
export function stylizedMaterial(opts: { vat?: VatAsset; rim?: string; rimStrength?: number; skinning?: boolean }): THREE.MeshToonMaterial & { userData: { uniforms: StylizedUniforms } } {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }) as THREE.MeshToonMaterial & { userData: { uniforms: StylizedUniforms } };
  const uniforms: StylizedUniforms = {
    uTime: { value: 0 },
    uRim: { value: new THREE.Color(opts.rim ?? '#ffffff').multiplyScalar(opts.rimStrength ?? 0.35) },
  };
  mat.userData.uniforms = uniforms;
  const vat = opts.vat;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uRim = uniforms.uRim;
    if (vat) {
      shader.uniforms.uVatPos = { value: vat.pos };
      shader.uniforms.uVatNrm = { value: vat.nrm };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aAnim;
uniform sampler2D uVatPos;
uniform sampler2D uVatNrm;
uniform float uTime;
const int VAT_W = ${vat.width};
const int VAT_ROWS = ${vat.rowsPerFrame};
vec3 vatP;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `float vfr = max(0.0, uTime - aAnim.z) * abs(aAnim.w);
float vfa = aAnim.w > 0.0 ? mod(vfr, aAnim.y) : min(vfr, aAnim.y - 1.0);
float vf0 = floor(vfa);
float vf1 = aAnim.w > 0.0 ? mod(vf0 + 1.0, aAnim.y) : min(vf0 + 1.0, aAnim.y - 1.0);
float vbl = vfa - vf0;
int vcol = gl_VertexID % VAT_W;
int vrow = gl_VertexID / VAT_W;
ivec2 vc0 = ivec2(vcol, int(aAnim.x + vf0) * VAT_ROWS + vrow);
ivec2 vc1 = ivec2(vcol, int(aAnim.x + vf1) * VAT_ROWS + vrow);
vatP = mix(texelFetch(uVatPos, vc0, 0).xyz, texelFetch(uVatPos, vc1, 0).xyz, vbl);
vec3 objectNormal = normalize(mix(texelFetch(uVatNrm, vc0, 0).xyz, texelFetch(uVatNrm, vc1, 0).xyz, vbl));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = vatP;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
#include <opaque_fragment>`,
      );
  };
  // distinct program per VAT layout
  mat.customProgramCacheKey = () => (vat ? `vat:${vat.width}:${vat.rowsPerFrame}` : 'toon-rim');
  return mat;
}

/** InstancedMesh with a per-instance aAnim attribute. */
export function vatInstanced(asset: VatAsset, material: THREE.Material, capacity: number): THREE.InstancedMesh & { anim: THREE.InstancedBufferAttribute } {
  const geo = asset.geometry.clone();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', anim);
  const mesh = new THREE.InstancedMesh(geo, material, capacity) as THREE.InstancedMesh & { anim: THREE.InstancedBufferAttribute };
  mesh.anim = anim;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/** Write instance i's animation: loop clip with a phase offset, or a one-shot started at `startTime`. */
export function setAnim(mesh: { anim: THREE.InstancedBufferAttribute }, i: number, c: VatClip, startTime: number, speed = 1): void {
  const a = mesh.anim.array as Float32Array;
  a[i * 4] = c.start;
  a[i * 4 + 1] = c.frames;
  a[i * 4 + 2] = startTime;
  a[i * 4 + 3] = (c.loop ? 1 : -1) * c.fps * speed;
}
