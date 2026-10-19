/** Canvas-generated textures (gate faces, loot icons), cached by key. */
import * as THREE from 'three';
import type { Reward } from '../schema/types';

const cache = new Map<string, THREE.CanvasTexture>();
export const DISPLAY_FONT = "'Lilita One', 'Arial Black', Impact, sans-serif";

function make(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

export function gateLabel(op: string, value: number): string {
  if (op === 'add') return `+${value}`;
  if (op === 'sub') return `-${value}`;
  if (op === 'mul') return `x${value}`;
  return `÷${value}`;
}

/** Gate face: translucent tinted panel with a big outlined number. */
export function gateTexture(label: string, fill: string, text: string, outline: string): THREE.CanvasTexture {
  return make(`gate:${label}:${fill}:${text}`, 256, 160, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 160);
    g.addColorStop(0, fill + 'ee');
    g.addColorStop(1, fill + '99');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#ffffffcc';
    c.lineWidth = 8;
    c.strokeRect(4, 4, 248, 152);
    c.font = `92px ${DISPLAY_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 14;
    c.strokeStyle = outline;
    c.strokeText(label, 128, 86);
    c.fillStyle = text;
    c.fillText(label, 128, 86);
  });
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Loot icon with a rarity-colored glow outline. Simple silhouettes, no copied art. */
export function rewardTexture(r: Reward, glow: string): THREE.CanvasTexture {
  const key = `reward:${JSON.stringify(r)}:${glow}`;
  return make(key, 192, 192, (c) => {
    c.translate(96, 96);
    c.shadowColor = glow;
    c.shadowBlur = 26;
    c.lineJoin = 'round';
    c.lineWidth = 10;
    c.strokeStyle = glow;
    c.fillStyle = '#20232b';
    const outlineFill = (path: () => void, fill = '#2a2d36') => {
      path();
      c.fillStyle = fill;
      c.stroke();
      c.shadowBlur = 0;
      c.fill();
      c.shadowBlur = 26;
    };
    switch (r.kind) {
      case 'weapon':
      case 'weapon_level':
        outlineFill(() => {
          c.beginPath();
          c.moveTo(-70, -22);
          c.lineTo(62, -22);
          c.lineTo(62, -2);
          c.lineTo(-10, -2);
          c.lineTo(-18, 40);
          c.lineTo(-44, 40);
          c.lineTo(-38, -2);
          c.lineTo(-70, -2);
          c.closePath();
        }, r.kind === 'weapon' && r.weaponId.includes('gold') ? '#d9a520' : '#3a3e48');
        if (r.kind === 'weapon_level') {
          c.font = `56px ${DISPLAY_FONT}`;
          c.fillStyle = '#fff';
          c.textAlign = 'center';
          c.fillText('▲', 30, 60);
        }
        break;
      case 'recruits':
        outlineFill(() => {
          c.beginPath();
          c.arc(0, -30, 24, 0, Math.PI * 2);
          c.moveTo(-40, 50);
          c.quadraticCurveTo(-40, 2, 0, 2);
          c.quadraticCurveTo(40, 2, 40, 50);
          c.closePath();
        }, '#3a3e48');
        c.font = `52px ${DISPLAY_FONT}`;
        c.textAlign = 'center';
        c.lineWidth = 8;
        c.strokeStyle = '#000';
        c.strokeText(`+${r.count}`, 40, 72);
        c.fillStyle = '#fff';
        c.fillText(`+${r.count}`, 40, 72);
        break;
      case 'leader_shard':
        outlineFill(() => {
          c.beginPath();
          c.moveTo(0, -60);
          c.lineTo(44, -10);
          c.lineTo(0, 60);
          c.lineTo(-44, -10);
          c.closePath();
        }, '#9be7ff');
        break;
      case 'vehicle':
        outlineFill(() => {
          roundRect(c, -72, -10, 144, 40, 12);
          c.moveTo(-36, -10);
          c.lineTo(-20, -38);
          c.lineTo(28, -38);
          c.lineTo(44, -10);
        }, r.vehicle === 'lowrider' ? '#6b2bd1' : '#e05a1b');
        c.fillStyle = '#111';
        c.beginPath();
        c.arc(-40, 32, 15, 0, Math.PI * 2);
        c.arc(40, 32, 15, 0, Math.PI * 2);
        c.fill();
        break;
      case 'drum_mag':
        outlineFill(() => {
          c.beginPath();
          c.arc(0, 0, 50, 0, Math.PI * 2);
        }, '#3a3e48');
        c.fillStyle = '#c9a227';
        c.beginPath();
        c.arc(0, 0, 18, 0, Math.PI * 2);
        c.fill();
        break;
      case 'armor_vest':
        outlineFill(() => {
          c.beginPath();
          c.moveTo(-50, -50);
          c.lineTo(-20, -50);
          c.lineTo(0, -30);
          c.lineTo(20, -50);
          c.lineTo(50, -50);
          c.lineTo(50, 55);
          c.lineTo(-50, 55);
          c.closePath();
        }, '#3c4a5c');
        break;
      case 'cash':
        outlineFill(() => roundRect(c, -64, -34, 128, 68, 10), '#2f9e44');
        c.font = `56px ${DISPLAY_FONT}`;
        c.textAlign = 'center';
        c.fillStyle = '#fff';
        c.fillText('$', 0, 20);
        break;
    }
  });
}

/** Soft radial glow sprite (loot halo, light bar bloom). */
export function glowTexture(): THREE.CanvasTexture {
  return make('glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

/** Asphalt with subtle noise + cracks so the road reads at speed. */
export function asphaltTexture(base: string): THREE.CanvasTexture {
  const t = make(`asphalt:${base}`, 256, 256, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = Math.random() * 40 - 20;
      c.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 400})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      c.beginPath();
      let x = Math.random() * 256;
      let y = Math.random() * 256;
      c.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += Math.random() * 30 - 15;
        y += Math.random() * 30 - 15;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
