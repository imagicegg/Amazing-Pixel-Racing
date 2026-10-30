// Pseudo-3D ("mode 7") view of the flat track: a camera hovers behind the car
// and looks ahead to a horizon. Turning then looks like turning your head
// (yaw) rather than the whole flat picture spinning (roll), which is much
// easier on the stomach. Pure code: draws into a Uint32Array.
import { Raster } from '../art/raster.ts';

export interface PerspectiveCamera {
  /** Camera position over the ground, world px. */
  x: number;
  y: number;
  /** Direction it looks, radians (0 = +x). */
  yaw: number;
  /** Height above the ground, world px. */
  height: number;
  /** Focal length in screen px: larger means a narrower, more zoomed view. */
  focal: number;
  /** Screen row of the horizon. */
  horizon: number;
  /** Screen column of the view centre. */
  centerX: number;
}

export interface Projected {
  sx: number;
  /** Screen row where this ground point appears. */
  sy: number;
  /** Distance in front of the camera, world px. */
  depth: number;
  /** Screen px per world px at that distance. */
  scale: number;
}

/** Projects a ground point; returns false when it is behind (or right under) the camera. */
export function project(cam: PerspectiveCamera, px: number, py: number, out: Projected, near = 10): boolean {
  const fx = Math.cos(cam.yaw);
  const fy = Math.sin(cam.yaw);
  const dx = px - cam.x;
  const dy = py - cam.y;
  const depth = dx * fx + dy * fy;
  if (depth < near) return false;
  const side = -dx * fy + dy * fx;
  const scale = cam.focal / depth;
  out.sx = cam.centerX + side * scale;
  out.sy = cam.horizon + cam.height * scale;
  out.depth = depth;
  out.scale = scale;
  return true;
}

/** Half-size copy (2x2 average), so distant ground can be drawn without shimmering. */
export function halfSize(r: Raster): Raster {
  const w = Math.max(1, r.w >> 1);
  const h = Math.max(1, r.h >> 1);
  const out = new Raster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      for (let k = 0; k < 4; k++) {
        const c = r.px[(y * 2 + (k >> 1)) * r.w + x * 2 + (k & 1)];
        rr += c & 0xff;
        gg += (c >>> 8) & 0xff;
        bb += (c >>> 16) & 0xff;
      }
      out.px[y * w + x] = (0xff000000 | ((bb >> 2) << 16) | ((gg >> 2) << 8) | (rr >> 2)) >>> 0;
    }
  }
  return out;
}

/** Full-size ground plus three smaller copies (1/2, 1/4, 1/8). */
export function groundLevels(r: Raster): Raster[] {
  const levels = [r];
  for (let i = 0; i < 3; i++) levels.push(halfSize(levels[levels.length - 1]));
  return levels;
}

export interface GroundStyle {
  /** Packed colour the ground fades into near the horizon. */
  fog: number;
  fogStart: number;
  fogEnd: number;
  /** Packed colour for ground outside the painted world. */
  outside: number;
}

/**
 * Draws the ground below the horizon into `out` (w x h pixels, row 0 is the
 * screen row just below the horizon). Every screen row is a straight line
 * across the ground at one distance, so each row is a simple walk.
 */
export function renderGround(out: Uint32Array, w: number, h: number, cam: PerspectiveCamera, levels: Raster[], style: GroundStyle): void {
  const fx = Math.cos(cam.yaw);
  const fy = Math.sin(cam.yaw);
  const fogR = style.fog & 0xff;
  const fogG = (style.fog >>> 8) & 0xff;
  const fogB = (style.fog >>> 16) & 0xff;
  for (let row = 0; row < h; row++) {
    const below = row + 0.5;
    const depth = (cam.height * cam.focal) / below;
    const o = row * w;
    const fog = Math.min(1, Math.max(0, (depth - style.fogStart) / (style.fogEnd - style.fogStart)));
    if (fog >= 1) {
      out.fill(style.fog, o, o + w);
      continue;
    }
    // world px per screen px across this row, and along the view per row
    const across = depth / cam.focal;
    const along = (depth * depth) / (cam.height * cam.focal);
    const footprint = Math.max(across, along * 0.5);
    const level = footprint < 1.5 ? 0 : footprint < 3 ? 1 : footprint < 6 ? 2 : 3;
    const m = levels[level];
    const s = 1 / (1 << level);
    const mw = m.w;
    const mh = m.h;
    const px = m.px;
    // walk the row from its left end to its right end
    const startSide = (0.5 - cam.centerX) * across;
    let wx = (cam.x + fx * depth - fy * startSide) * s;
    let wy = (cam.y + fy * depth + fx * startSide) * s;
    const stepX = -fy * across * s;
    const stepY = fx * across * s;
    const keep = Math.round((1 - fog) * 256);
    const fr = fogR * (256 - keep);
    const fg = fogG * (256 - keep);
    const fb = fogB * (256 - keep);
    for (let col = 0; col < w; col++) {
      let c: number;
      if (wx >= 0 && wy >= 0 && wx < mw && wy < mh) c = px[(wy | 0) * mw + (wx | 0)];
      else c = style.outside;
      if (keep < 256) {
        const r = ((c & 0xff) * keep + fr) >> 8;
        const g = (((c >>> 8) & 0xff) * keep + fg) >> 8;
        const b = (((c >>> 16) & 0xff) * keep + fb) >> 8;
        c = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
      out[o + col] = c;
      wx += stepX;
      wy += stepY;
    }
  }
}
