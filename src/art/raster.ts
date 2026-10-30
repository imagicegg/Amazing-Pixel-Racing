// Tiny software "canvas" used to build every sprite in the game.
// It has no DOM or Phaser dependency, so the same code runs in the browser
// (to create textures) and in Node (for tests and sprite previews).

/** Packs a colour into the 32-bit little-endian RGBA layout used by ImageData. */
export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** '#rgb', '#rrggbb' or '#rrggbbaa' -> packed colour. */
export function hex(color: string): number {
  let h = color.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return rgba(r, g, b, a);
}

export function alphaOf(c: number): number {
  return c >>> 24;
}

/** Packed colour -> 0xRRGGBB, the format Phaser uses for tints and fills. */
export function toRGBInt(c: number): number {
  return ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff);
}

/** Linear blend of two packed colours (t = 0 -> a, t = 1 -> b). Alpha comes from a. */
export function mix(a: number, b: number, t: number): number {
  const r = (a & 0xff) + ((b & 0xff) - (a & 0xff)) * t;
  const g = ((a >>> 8) & 0xff) + (((b >>> 8) & 0xff) - ((a >>> 8) & 0xff)) * t;
  const bl = ((a >>> 16) & 0xff) + (((b >>> 16) & 0xff) - ((a >>> 16) & 0xff)) * t;
  return rgba(Math.round(r), Math.round(g), Math.round(bl), a >>> 24);
}

export function shade(c: number, f: number): number {
  return f < 0 ? mix(c, rgba(0, 0, 0, c >>> 24), -f) : mix(c, rgba(255, 255, 255, c >>> 24), f);
}

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;

  constructor(w: number, h: number, px?: Uint32Array) {
    this.w = w;
    this.h = h;
    this.px = px ?? new Uint32Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.px[y * this.w + x] : 0;
  }

  set(x: number, y: number, c: number): void {
    if (this.inside(x, y)) this.px[y * this.w + x] = c;
  }

  /** Writes c only when it is opaque enough; semi-transparent colours are blended. */
  plot(x: number, y: number, c: number): void {
    if (!this.inside(x, y)) return;
    const a = c >>> 24;
    if (a === 0) return;
    const i = y * this.w + x;
    this.px[i] = a === 255 ? c : mix(this.px[i], c | 0xff000000, a / 255);
  }

  fill(c: number): this {
    this.px.fill(c);
    return this;
  }

  fillRect(x: number, y: number, w: number, h: number, c: number): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.plot(i, j, c);
    return this;
  }

  fillCircle(cx: number, cy: number, r: number, c: number): this {
    const r2 = r * r;
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.plot(i, j, c);
      }
    }
    return this;
  }

  /** Copies the opaque pixels of src onto this raster. */
  blit(src: Raster, dx: number, dy: number): this {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.px[y * src.w + x];
        if (c >>> 24) this.plot(dx + x, dy + y, c);
      }
    }
    return this;
  }

  clone(): Raster {
    return new Raster(this.w, this.h, this.px.slice());
  }

  /** A same-size silhouette: every visible pixel becomes `color`. */
  silhouette(color: number): Raster {
    const out = new Raster(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) if (this.px[i] >>> 24) out.px[i] = color;
    return out;
  }

  /** Adds a 1px outline around the visible pixels (4-neighbourhood). */
  outlined(color: number): Raster {
    const out = new Raster(this.w + 2, this.h + 2);
    out.blit(this, 1, 1);
    const copy = out.px.slice();
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        if (copy[y * out.w + x] >>> 24) continue;
        const n =
          (x > 0 && copy[y * out.w + x - 1] >>> 24) ||
          (x < out.w - 1 && copy[y * out.w + x + 1] >>> 24) ||
          (y > 0 && copy[(y - 1) * out.w + x] >>> 24) ||
          (y < out.h - 1 && copy[(y + 1) * out.w + x] >>> 24);
        if (n) out.px[y * out.w + x] = color;
      }
    }
    return out;
  }

  flipX(): Raster {
    const out = new Raster(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) out.px[y * this.w + x] = this.px[y * this.w + (this.w - 1 - x)];
    return out;
  }

  /** Integer nearest-neighbour upscale. */
  scaled(f: number): Raster {
    const out = new Raster(this.w * f, this.h * f);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) out.px[y * out.w + x] = this.px[((y / f) | 0) * this.w + ((x / f) | 0)];
    return out;
  }

  /** RGBA bytes view, ready for `new ImageData(...)`. */
  bytes(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.px.buffer, this.px.byteOffset, this.px.byteLength);
  }
}

export type Palette = Record<string, string>;

/**
 * Turns an ASCII pixel map into a raster. Every character is one pixel and is
 * looked up in the palette; '.' and ' ' are always transparent.
 */
export function fromMap(rows: readonly string[], palette: Palette): Raster {
  const w = Math.max(...rows.map((r) => r.length));
  const out = new Raster(w, rows.length);
  const cache = new Map<string, number>();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      let c = cache.get(ch);
      if (c === undefined) {
        const def = palette[ch];
        if (def === undefined) throw new Error(`Pixel map uses '${ch}' but the palette has no colour for it`);
        c = def === 'transparent' ? 0 : hex(def);
        cache.set(ch, c);
      }
      out.px[y * w + x] = c;
    }
  });
  return out;
}

/** Scale2x / EPX: doubles a sprite while keeping hard pixel-art edges. */
export function scale2x(src: Raster): Raster {
  const { w, h } = src;
  const out = new Raster(w * 2, h * 2);
  const p = src.px;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = p[y * w + x];
      const A = y > 0 ? p[(y - 1) * w + x] : P;
      const B = x < w - 1 ? p[y * w + x + 1] : P;
      const C = x > 0 ? p[y * w + x - 1] : P;
      const D = y < h - 1 ? p[(y + 1) * w + x] : P;
      const o = y * 2 * out.w + x * 2;
      out.px[o] = C === A && C !== D && A !== B ? A : P;
      out.px[o + 1] = A === B && A !== C && B !== D ? B : P;
      out.px[o + out.w] = D === C && D !== B && C !== A ? C : P;
      out.px[o + out.w + 1] = B === D && B !== A && D !== C ? D : P;
    }
  }
  return out;
}

/**
 * RotSprite-style rotation: upscale 8x with Scale2x, then sample the big image
 * with nearest neighbour. Keeps pixel art crisp at any angle, unlike a plain
 * nearest-neighbour rotation. Pass `big` to reuse an already upscaled source.
 */
export function rotSprite(src: Raster, angle: number, outW: number, outH: number, big?: Raster): Raster {
  const up = big ?? scale2x(scale2x(scale2x(src)));
  const k = up.w / src.w;
  const out = new Raster(outW, outH);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cxo = outW / 2;
  const cyo = outH / 2;
  const cxs = src.w / 2;
  const cys = src.h / 2;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const dx = x + 0.5 - cxo;
      const dy = y + 0.5 - cyo;
      // inverse rotation, back into source space
      const sx = dx * cos + dy * sin + cxs;
      const sy = -dx * sin + dy * cos + cys;
      const bx = Math.floor(sx * k);
      const by = Math.floor(sy * k);
      if (bx < 0 || by < 0 || bx >= up.w || by >= up.h) continue;
      out.px[y * outW + x] = up.px[by * up.w + bx];
    }
  }
  return out;
}

/** Deterministic pseudo random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash noise in [0, 1) for a pixel coordinate. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
