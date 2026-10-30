// Everything above the horizon in the chase view: one panorama covering a full
// 360-degree turn (sky gradient, clouds or stars, and a skyline of hills,
// mesas or towers standing on the horizon). The view samples it by angle, so
// turning pans it exactly like distant scenery.
import { Raster, hash2, hex, mix, rng } from '../art/raster.ts';
import type { ThemeId } from './tracks.ts';

export interface Panorama {
  /** width = one full turn; the bottom row sits on the horizon. */
  raster: Raster;
  /** Colour right at the horizon. Distant ground fades into it. */
  haze: number;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Vertical gradient through `stops`, with ordered dithering between bands. */
function gradient(r: Raster, stops: string[]): void {
  const cols = stops.map(hex);
  for (let y = 0; y < r.h; y++) {
    const t = (y / Math.max(1, r.h - 1)) * (cols.length - 1);
    const i = Math.min(cols.length - 2, Math.floor(t));
    const f = t - i;
    for (let x = 0; x < r.w; x++) {
      const threshold = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      r.px[y * r.w + x] = f > threshold ? cols[i + 1] : cols[i];
    }
  }
}

/** Smooth bumps that repeat exactly once around the panorama. */
function wave(x: number, w: number, seed: number, amps: number[]): number {
  const R = rng(seed);
  let v = 0;
  amps.forEach((a, k) => {
    const turns = [2, 3, 5, 7, 11, 13][k] ?? k + 2;
    v += a * Math.sin(((Math.PI * 2 * turns) / w) * x + R() * Math.PI * 2);
  });
  return v;
}

const wrapX = (r: Raster, x: number) => ((Math.round(x) % r.w) + r.w) % r.w;

/** Fills from `top` down to the bottom of the panorama. */
function column(r: Raster, x: number, top: number, color: number): void {
  const xx = wrapX(r, x);
  for (let y = Math.max(0, Math.round(top)); y < r.h; y++) r.px[y * r.w + xx] = color;
}

function rect(r: Raster, x: number, y: number, w: number, h: number, color: number): void {
  for (let i = 0; i < w; i++) {
    const xx = wrapX(r, x + i);
    for (let j = Math.max(0, y); j < Math.min(r.h, y + h); j++) r.px[j * r.w + xx] = color;
  }
}

function disc(r: Raster, cx: number, cy: number, rad: number, color: number): void {
  for (let dy = -Math.ceil(rad); dy <= rad; dy++) {
    for (let dx = -Math.ceil(rad); dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const y = Math.round(cy + dy);
      if (y >= 0 && y < r.h) r.px[y * r.w + wrapX(r, cx + dx)] = color;
    }
  }
}

/** Puffy pixel clouds: a row of overlapping discs with a flat, shaded base. */
function clouds(r: Raster, count: number, top: number, bottom: number, light: string, shadow: string, R: () => number): void {
  const lc = hex(light);
  const sc = hex(shadow);
  for (let k = 0; k < count; k++) {
    const cx = R() * r.w;
    const base = top + R() * (bottom - top);
    const puffs = 3 + Math.floor(R() * 4);
    const span = puffs * 7;
    for (let i = 0; i < puffs; i++) {
      const px = cx - span / 2 + (i + 0.5) * (span / puffs);
      const rad = 3 + R() * 4 + (i > 0 && i < puffs - 1 ? 2 : 0);
      disc(r, px, base - rad * 0.6, rad, lc);
    }
    // flat, shaded underside
    rect(r, Math.round(cx - span / 2), Math.round(base), Math.round(span), 2, sc);
  }
}

function meadow(r: Raster, seed: number): void {
  const R = rng(seed + 9);
  clouds(r, Math.round(r.w / 170), 6, r.h - 34, '#ffffff', '#d6ecfa', R);
  const W = r.w;
  const ground = r.h;
  const far = hex('#86c9b0');
  const near = hex('#4f9d5e');
  const tree = hex('#3a8550');
  const treeLight = hex('#5fb86a');
  for (let x = 0; x < W; x++) column(r, x, ground - 18 - wave(x, W, seed, [5, 3, 2]), far);
  for (let x = 0; x < W; x++) column(r, x, ground - 8 - wave(x, W, seed + 1, [3, 2, 1.5]), near);
  // round trees on the near hills
  for (let k = 0; k < W / 14; k++) {
    const cx = Math.floor(R() * W);
    const top = ground - 8 - wave(cx, W, seed + 1, [3, 2, 1.5]);
    const rad = 2 + R() * 2.5;
    disc(r, cx, top - rad + 1, rad, tree);
    disc(r, cx - 1, top - rad, rad * 0.45, treeLight);
  }
}

function canyon(r: Raster, seed: number): void {
  const R = rng(seed + 9);
  clouds(r, Math.round(r.w / 260), 4, r.h - 40, '#fff6e6', '#f2d6b8', R);
  const W = r.w;
  const ground = r.h;
  const far = hex('#e2ad84');
  const farTop = hex('#f0c49c');
  const near = hex('#c47f52');
  const cactus = hex('#4a8a5c');
  // flat-topped mesas with steep sides
  for (let k = 0; k < W / 70; k++) {
    const cx = R() * W;
    const half = 16 + R() * 44;
    const top = ground - 22 - R() * 14;
    for (let dx = -half - 10; dx <= half + 10; dx++) {
      const edge = Math.abs(dx) - half;
      const y = edge <= 0 ? top : top + edge * 2.4;
      if (y >= ground) continue;
      column(r, cx + dx, y, far);
      if (edge <= 0) r.px[Math.round(y) * W + wrapX(r, cx + dx)] = farTop;
    }
  }
  for (let x = 0; x < W; x++) column(r, x, ground - 6 - wave(x, W, seed + 3, [2.5, 1.5, 1]), near);
  for (let k = 0; k < W / 24; k++) {
    const x = Math.floor(R() * W);
    const base = Math.round(ground - 6 - wave(x, W, seed + 3, [2.5, 1.5, 1]));
    const h = 4 + Math.floor(R() * 4);
    rect(r, x, base - h, 1, h, cactus);
    if (h > 5) {
      rect(r, x - 2, base - h + 2, 1, 2, cactus);
      rect(r, x - 1, base - h + 3, 1, 1, cactus);
      rect(r, x + 2, base - h + 1, 1, 2, cactus);
      rect(r, x + 1, base - h + 2, 1, 1, cactus);
    }
  }
}

function city(r: Raster, seed: number): void {
  const R = rng(seed + 9);
  const W = r.w;
  // stars and a moon in the dark upper sky
  for (let y = 0; y < r.h - 30; y++) {
    for (let x = 0; x < W; x++) {
      const h = hash2(x, y, seed);
      if (h < 0.004) r.px[y * W + x] = h < 0.0015 ? hex('#ffffff') : hex('#9fb4ff');
    }
  }
  const moonX = R() * W;
  disc(r, moonX, 14, 6, hex('#fff3c4'));
  disc(r, moonX + 3, 12, 5, r.px[2 * W + wrapX(r, moonX + 40)]);
  const far = hex('#2b2752');
  const near = hex('#1b1836');
  const lights = ['#ffe9a8', '#ffcd75', '#73eff7', '#ff79c6'].map(hex);
  const tower = (x: number, w: number, h: number, body: number, lit: number) => {
    rect(r, x, r.h - h, w, h, body);
    for (let wy = r.h - h + 2; wy < r.h - 2; wy += 3) {
      for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        if (R() < lit) rect(r, wx, wy, 1, 1, lights[Math.floor(R() * lights.length)]);
      }
    }
  };
  for (let x = 0; x < W; ) {
    const w = 10 + Math.floor(R() * 26);
    const h = 16 + Math.floor(R() * 24);
    tower(x, Math.min(w, W - x), h, far, 0.18);
    if (h > 32 && R() < 0.6) {
      rect(r, x + (w >> 1), r.h - h - 5, 1, 5, far);
      rect(r, x + (w >> 1), r.h - h - 6, 1, 1, hex('#e43b44'));
    }
    x += w + Math.floor(R() * 3);
  }
  for (let x = 0; x < W; ) {
    const w = 8 + Math.floor(R() * 20);
    const h = 6 + Math.floor(R() * 14);
    tower(x, Math.min(w, W - x), h, near, 0.32);
    x += w + 2 + Math.floor(R() * 10);
  }
}

const SKIES: Record<ThemeId, string[]> = {
  meadow: ['#3f93e6', '#5eb0f5', '#8fcdfb', '#c6ecff'],
  canyon: ['#4f9be0', '#8ec2ea', '#e8d5b2', '#ffe1b0'],
  city: ['#080a18', '#12163a', '#251f52', '#46306e'],
};

/**
 * Panorama for a theme. `width` should be 2 * PI * focal length, so it pans
 * at the same rate as the ground when the camera turns.
 */
export function buildPanorama(theme: ThemeId, width: number, height: number, seed: number): Panorama {
  const stops = SKIES[theme];
  const raster = new Raster(width, height);
  gradient(raster, stops);
  if (theme === 'meadow') meadow(raster, seed);
  else if (theme === 'canyon') canyon(raster, seed);
  else city(raster, seed);
  const haze = hex(stops[stops.length - 1]);
  // the foot of the skyline fades into the same mist as the far ground
  const mist = Math.min(12, height);
  for (let y = height - mist; y < height; y++) {
    const t = Math.pow((y - (height - mist) + 1) / mist, 1.6) * 0.9;
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      const d = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      raster.px[o] = mix(raster.px[o], haze, Math.min(1, Math.floor(t * 4 + d) / 4));
    }
  }
  return { raster, haze };
}

