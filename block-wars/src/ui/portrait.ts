/** Draws a flat leader portrait from the outfit config (placeholder until final art). */
import type { Character } from '../schema/types';

export function drawPortrait(canvas: HTMLCanvasElement, ch: Character, bg: string): void {
  const s = canvas.width;
  const c = canvas.getContext('2d')!;
  const o = ch.outfit;
  c.clearRect(0, 0, s, s);
  c.fillStyle = bg;
  c.fillRect(0, 0, s, s);
  const u = s / 100;
  // shoulders / top
  c.fillStyle = o.topColor;
  c.fillRect(14 * u, 74 * u, 72 * u, 30 * u);
  c.fillStyle = o.shirtColor;
  c.fillRect(40 * u, 74 * u, 20 * u, 30 * u);
  if (o.chain) {
    c.strokeStyle = '#dfe3ea';
    c.lineWidth = 3 * u;
    c.beginPath();
    c.arc(50 * u, 72 * u, 12 * u, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
  }
  // neck + head
  c.fillStyle = ch.skinTone;
  c.fillRect(42 * u, 60 * u, 16 * u, 16 * u);
  c.beginPath();
  c.roundRect(28 * u, 22 * u, 44 * u, 44 * u, 10 * u);
  c.fill();
  // ears
  c.fillRect(24 * u, 40 * u, 6 * u, 10 * u);
  c.fillRect(70 * u, 40 * u, 6 * u, 10 * u);
  c.fillStyle = '#c0c4cc';
  c.fillRect(72 * u, 50 * u, 3 * u, 3 * u);
  // face
  c.fillStyle = '#1b120d';
  if (o.sunglasses) {
    c.fillStyle = '#0b0b0f';
    c.fillRect(31 * u, 38 * u, 38 * u, 9 * u);
  } else {
    c.fillRect(37 * u, 40 * u, 7 * u, 4 * u);
    c.fillRect(56 * u, 40 * u, 7 * u, 4 * u);
    c.fillRect(35 * u, 35 * u, 11 * u, 2.5 * u);
    c.fillRect(54 * u, 35 * u, 11 * u, 2.5 * u);
  }
  c.fillStyle = '#3a2219';
  c.fillRect(42 * u, 55 * u, 16 * u, 3 * u);
  // headwear
  c.fillStyle = o.hatColor;
  if (o.hat === 'snapback_back' || o.hat === 'fitted') {
    c.beginPath();
    c.roundRect(26 * u, 14 * u, 48 * u, 16 * u, 8 * u);
    c.fill();
    if (o.hat === 'fitted') c.fillRect(30 * u, 26 * u, 46 * u, 5 * u);
    else {
      c.fillStyle = '#ffffff';
      c.fillRect(44 * u, 26 * u, 12 * u, 3 * u);
    }
  } else if (o.hat === 'bandana' || o.hat === 'durag') {
    c.beginPath();
    c.roundRect(26 * u, 16 * u, 48 * u, 15 * u, 6 * u);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 5; i++) c.fillRect((31 + i * 9) * u, 21 * u, 3 * u, 3 * u);
  } else if (o.hat === 'beanie') {
    c.beginPath();
    c.roundRect(26 * u, 10 * u, 48 * u, 22 * u, 10 * u);
    c.fill();
  }
  if (o.tattoos.includes('neck')) {
    c.fillStyle = 'rgba(20,20,30,0.55)';
    c.fillRect(44 * u, 64 * u, 6 * u, 6 * u);
  }
}
