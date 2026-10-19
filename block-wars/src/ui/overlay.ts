/**
 * World-anchored DOM overlay: crew/horde counts, obstacle HP, boss bar,
 * floating damage numbers and phase banners. Elements are pooled; each frame
 * only transforms/text that changed are written.
 */
export type LabelKind = 'crew' | 'horde' | 'hp' | 'boss';

interface Slot {
  el: HTMLDivElement;
  text: HTMLSpanElement;
  bar: HTMLDivElement | null;
  lastText: string;
  lastBar: number;
  kind: LabelKind;
}

export class Overlay {
  readonly root: HTMLDivElement;
  private slots = new Map<LabelKind, Slot[]>();
  private used = new Map<LabelKind, number>();
  private dmg: { el: HTMLDivElement; life: number; x: number; y: number; z: number }[] = [];
  private dmgNext = 0;
  private bannerEl: HTMLDivElement;
  private bannerTimer = 0;

  constructor(parent: HTMLElement, maxDamageNumbers: number, private dmgLife: number) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    parent.appendChild(this.root);
    for (let i = 0; i < maxDamageNumbers; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.display = 'none';
      this.root.appendChild(el);
      this.dmg.push({ el, life: 0, x: 0, y: 0, z: 0 });
    }
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'banner';
    parent.appendChild(this.bannerEl);
  }

  setFactionColor(color: string): void {
    this.root.parentElement!.style.setProperty('--faction', color);
  }

  begin(): void {
    for (const k of this.used.keys()) this.used.set(k, 0);
  }

  label(kind: LabelKind, sx: number, sy: number, text: string, bar = -1, visible = true): void {
    if (!visible) return;
    const list = this.slots.get(kind) ?? [];
    this.slots.set(kind, list);
    const n = this.used.get(kind) ?? 0;
    this.used.set(kind, n + 1);
    let s = list[n];
    if (!s) {
      const el = document.createElement('div');
      el.className = `lbl lbl-${kind}`;
      const text = document.createElement('span');
      el.appendChild(text);
      let barEl: HTMLDivElement | null = null;
      if (kind === 'horde' || kind === 'boss') {
        const wrap = document.createElement('div');
        wrap.className = 'bar';
        barEl = document.createElement('div');
        wrap.appendChild(barEl);
        el.appendChild(wrap);
      }
      this.root.appendChild(el);
      s = { el, text, bar: barEl, lastText: '', lastBar: -1, kind };
      list.push(s);
    }
    s.el.style.display = '';
    s.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    if (s.lastText !== text) {
      s.text.textContent = text;
      s.lastText = text;
    }
    if (s.bar && Math.abs(s.lastBar - bar) > 0.002) {
      s.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, bar))})`;
      s.lastBar = bar;
    }
  }

  end(): void {
    for (const [k, list] of this.slots) {
      const n = this.used.get(k) ?? 0;
      for (let i = n; i < list.length; i++) list[i].el.style.display = 'none';
    }
  }

  spawnDamage(x: number, y: number, z: number, text: string, cls: string): void {
    const d = this.dmg[this.dmgNext];
    this.dmgNext = (this.dmgNext + 1) % this.dmg.length;
    d.life = this.dmgLife;
    d.x = x + (Math.random() - 0.5) * 0.6;
    d.y = y;
    d.z = z;
    d.el.className = `dmg ${cls}`;
    d.el.textContent = text;
    d.el.style.display = '';
  }

  /** project: world → screen px (null when behind camera) */
  updateDamage(dt: number, project: (x: number, y: number, z: number) => { x: number; y: number } | null): void {
    for (const d of this.dmg) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.y += dt * 2.2;
      const p = project(d.x, d.y, d.z);
      if (d.life <= 0 || !p) {
        d.el.style.display = 'none';
        continue;
      }
      const t = d.life / this.dmgLife;
      d.el.style.opacity = String(Math.min(1, t * 2.5));
      d.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${(0.8 + (1 - t) * 0.4).toFixed(2)})`;
    }
  }

  banner(text: string, duration: number, cls = ''): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = `banner show ${cls}`;
    // restart CSS animation
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('anim');
    this.bannerTimer = duration;
  }

  updateBanner(dt: number): void {
    if (this.bannerTimer <= 0) return;
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.bannerEl.className = 'banner';
  }

  clear(): void {
    this.begin();
    this.end();
    for (const d of this.dmg) {
      d.life = 0;
      d.el.style.display = 'none';
    }
    this.bannerEl.className = 'banner';
    this.bannerTimer = 0;
  }
}
