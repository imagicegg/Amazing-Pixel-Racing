// The lie of the land around the road, for the 3D view and the overhead
// view's hill shading: heights on a grid every TERRAIN_STEP px. Across the
// road's band (asphalt, run-off and barrier) the ground is exactly the road's
// height, so cars drive on what you see; beyond the barrier it eases over
// BLEND px to the plain. The plain rises into broad hills where the road
// climbs, rolls gently, and has a river channel cut into it where the track
// has a river. Pure code, so Node can run it.
import { valueNoise } from '../art/raster.ts';
import { WALL_THICKNESS, cutsFor, heightAt, type TrackGeometry } from './geometry.ts';
import type { River } from './tracks.ts';

const TERRAIN_STEP = 8;
/** Distance over which the ground beside the road eases to the plain, px. */
const BLEND = 110;
/** Under a bridge, the embankment of the road leading onto it ends in a slope this long. */
const END_SLOPE = 28;
/** The ground under a bridge stays at least this far below its road, px (the slab is 6 thick). */
const UNDER_DECK = 9;
/** Depth of a river's bed below the plain, px. */
const RIVER_DEPTH = 10;
/** How far the river's banks slope down to the water, px. */
const BANK = 16;
/**
 * The land rises and falls with the track: the road's heights, averaged over
 * this far around (px), shape broad hills, so a climbing road runs up a
 * hillside rather than along an embankment...
 */
const HILL_REACH = 160;
/** ...fading out where there is little road around to shape them (share of the area that is road). */
const HILL_FLOOR = 0.3;
/** How much the plain rolls, px either way, per theme. */
const ROLL: Record<string, number> = { meadow: 7, canyon: 5, city: 0 };

export interface Terrain {
  step: number;
  /** Grid vertices across and down. */
  cols: number;
  rows: number;
  h: Float32Array;
  /**
   * Per world pixel: distance to the river's middle, px, capped at 255
   * (255 everywhere when there is no river).
   */
  river: Uint8Array | null;
}

/** A river's course as a smooth polyline, a point every few px (x, y pairs). */
export function riverPath(river: River): number[] {
  const p = river.points;
  const out: number[] = [];
  for (let k = 0; k + 1 < p.length; k++) {
    const p0 = p[Math.max(0, k - 1)];
    const p1 = p[k];
    const p2 = p[k + 1];
    const p3 = p[Math.min(p.length - 1, k + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const last = p[p.length - 1];
  out.push(last[0], last[1]);
  return out;
}

/** Per pixel distance to the river's middle (the lake counts as a wide part of it), capped at 255. */
export function riverField(river: River, w: number, h: number): Uint8Array {
  const field = new Uint8Array(w * h).fill(255);
  const path = riverPath(river);
  const reach = river.width / 2 + BANK + 30;
  const put = (x: number, y: number, d: number) => {
    const o = y * w + x;
    const q = Math.min(255, Math.max(0, Math.round(d)));
    if (q < field[o]) field[o] = q;
  };
  for (let k = 0; k + 3 < path.length; k += 2) {
    const ax = path[k];
    const ay = path[k + 1];
    const ex = path[k + 2] - ax;
    const ey = path[k + 3] - ay;
    const el2 = ex * ex + ey * ey || 1;
    for (let y = Math.max(0, Math.floor(Math.min(ay, ay + ey) - reach)); y <= Math.min(h - 1, Math.ceil(Math.max(ay, ay + ey) + reach)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, ax + ex) - reach)); x <= Math.min(w - 1, Math.ceil(Math.max(ax, ax + ex) + reach)); x++) {
        let t = ((x + 0.5 - ax) * ex + (y + 0.5 - ay) * ey) / el2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        put(x, y, Math.hypot(ax + ex * t - x - 0.5, ay + ey * t - y - 0.5));
      }
    }
  }
  const lake = river.lake;
  if (lake) {
    const r = Math.min(lake.rx, lake.ry);
    for (let y = Math.max(0, Math.floor(lake.y - lake.ry - reach)); y <= Math.min(h - 1, Math.ceil(lake.y + lake.ry + reach)); y++) {
      for (let x = Math.max(0, Math.floor(lake.x - lake.rx - reach)); x <= Math.min(w - 1, Math.ceil(lake.x + lake.rx + reach)); x++) {
        const e = Math.hypot((x + 0.5 - lake.x) / lake.rx, (y + 0.5 - lake.y) / lake.ry);
        put(x, y, (e - 1) * r + river.width / 2);
      }
    }
  }
  return field;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Box blur of a grid in place (rows, then columns), `r` cells either way, edges clamped. */
function blur(a: Float32Array, cols: number, rows: number, r: number): void {
  const line = new Float32Array(Math.max(cols, rows));
  const pass = (count: number, len: number, at: (k: number, i: number) => number) => {
    for (let k = 0; k < count; k++) {
      for (let i = 0; i < len; i++) line[i] = a[at(k, i)];
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += line[Math.min(len - 1, Math.max(0, i))];
      for (let i = 0; i < len; i++) {
        a[at(k, i)] = sum / (2 * r + 1);
        sum += line[Math.min(len - 1, i + r + 1)] - line[Math.max(0, i - r)];
      }
    }
  };
  pass(rows, cols, (k, i) => k * cols + i);
  pass(cols, rows, (k, i) => i * cols + k);
}

/** The plain: broad hills shaped by the track, gentle rolls, a river's channel, and level at the edges of the world. */
function plain(g: TrackGeometry, river: Uint8Array | null, riverW: number, x: number, y: number, hill: number): number {
  const def = g.def;
  const amp = ROLL[def.theme] ?? 0;
  let h = hill + (amp ? (valueNoise(x / 260, y / 260, def.seed + 41) - 0.5) * 2 * amp : 0);
  if (river) {
    const xi = Math.min(g.width - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(g.height - 1, Math.max(0, Math.round(y)));
    const d = river[yi * g.width + xi];
    // level water, banks sloping down to it
    const deep = 1 - smooth((d - riverW / 2) / BANK);
    h = h * (1 - deep) - RIVER_DEPTH * deep;
  }
  const edge = Math.min(x, y, g.width - x, g.height - y);
  return h * smooth(edge / 150);
}

export function buildTerrain(g: TrackGeometry): Terrain {
  const step = TERRAIN_STEP;
  const cols = Math.ceil(g.width / step) + 1;
  const rows = Math.ceil(g.height / step) + 1;
  const river = g.def.river ? riverField(g.def.river, g.width, g.height) : null;
  const riverW = g.def.river?.width ?? 0;
  const n = g.n;
  const inner = g.wallDist + WALL_THICKNESS;
  const reach = inner + BLEND;
  const near = new Float32Array(cols * rows).fill(Infinity);
  const roadH = new Float32Array(cols * rows);
  // the nearest bit of road on the ground (decks left out) and its height
  const cutReach = Math.ceil(reach / g.ds) + 3;
  for (let i = 0; i < n; i++) {
    if (g.deck[i]) continue;
    const cuts = cutsFor(g, i, cutReach);
    const ax = g.x[i];
    const ay = g.y[i];
    const ex = g.x[(i + 1) % n] - ax;
    const ey = g.y[(i + 1) % n] - ay;
    const len = Math.hypot(ex, ey) || 1;
    const c0 = Math.max(0, Math.floor((Math.min(ax, ax + ex) - reach) / step));
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, ax + ex) + reach) / step));
    const r0 = Math.max(0, Math.floor((Math.min(ay, ay + ey) - reach) / step));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, ay + ey) + reach) / step));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = c * step - ax;
        const py = r * step - ay;
        const t = (px * ex + py * ey) / (len * len);
        const tc = t < 0 ? 0 : t > 1 ? 1 : t;
        let d = Math.hypot(px - ex * tc, py - ey * tc);
        let s = (i + tc) * g.ds;
        // past a cut (under a bridge) the embankment ends in a short slope
        for (const k of cuts) {
          const qx = c * step - k.x;
          const qy = r * step - k.y;
          const past = qx * k.nx + qy * k.ny;
          if (past <= 0) continue;
          d = Math.max(inner, Math.abs(qx * k.ny - qy * k.nx)) + past * (BLEND / END_SLOPE);
          s = k.i * g.ds;
        }
        const o = r * cols + c;
        if (d < near[o]) {
          near[o] = d;
          roadH[o] = heightAt(g, s);
        }
      }
    }
  }
  // broad hills: the road's heights averaged far around (weighted by how much road there is)
  const weight = new Float32Array(cols * rows);
  const lift = new Float32Array(cols * rows);
  for (let o = 0; o < weight.length; o++) {
    if (near[o] > inner) continue;
    weight[o] = 1;
    lift[o] = roadH[o];
  }
  const hr = Math.round(HILL_REACH / step / 2);
  for (let k = 0; k < 2; k++) {
    blur(weight, cols, rows, hr);
    blur(lift, cols, rows, hr);
  }
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = r * cols + c;
      const base = plain(g, river, riverW, c * step, r * step, lift[o] / Math.max(weight[o], HILL_FLOOR));
      const d = near[o];
      h[o] = d <= inner ? roadH[o] : d === Infinity ? base : roadH[o] + (base - roadH[o]) * smooth((d - inner) / BLEND);
    }
  }
  // under a bridge the ground stays clear of the slab, sloping up beside it
  for (let i = 0; i < n; i++) {
    if (!g.deck[i]) continue;
    const cuts = cutsFor(g, i, cutReach);
    const ax = g.x[i];
    const ay = g.y[i];
    const ex = g.x[(i + 1) % n] - ax;
    const ey = g.y[(i + 1) % n] - ay;
    const el2 = ex * ex + ey * ey || 1;
    const top = heightAt(g, i * g.ds) - UNDER_DECK;
    const r = inner + 40;
    for (let rr = Math.max(0, Math.floor((Math.min(ay, ay + ey) - r) / step)); rr <= Math.min(rows - 1, Math.ceil((Math.max(ay, ay + ey) + r) / step)); rr++) {
      for (let c = Math.max(0, Math.floor((Math.min(ax, ax + ex) - r) / step)); c <= Math.min(cols - 1, Math.ceil((Math.max(ax, ax + ex) + r) / step)); c++) {
        const x = c * step;
        const y = rr * step;
        if (cuts.some((k) => (x - k.x) * k.nx + (y - k.y) * k.ny > 0)) continue;
        let t = ((x - ax) * ex + (y - ay) * ey) / el2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + ex * t - x, ay + ey * t - y);
        if (d > r) continue;
        const o = rr * cols + c;
        h[o] = Math.min(h[o], top + Math.max(0, d - inner) * 0.6);
      }
    }
  }
  return { step, cols, rows, h, river };
}

/** Ground height at a world point (bilinear between grid vertices). */
export function terrainAt(t: Terrain, x: number, y: number): number {
  const fx = Math.min(t.cols - 1.001, Math.max(0, x / t.step));
  const fy = Math.min(t.rows - 1.001, Math.max(0, y / t.step));
  const c = Math.floor(fx);
  const r = Math.floor(fy);
  const u = fx - c;
  const v = fy - r;
  const o = r * t.cols + c;
  const a = t.h[o] + (t.h[o + 1] - t.h[o]) * u;
  const b = t.h[o + t.cols] + (t.h[o + t.cols + 1] - t.h[o + t.cols]) * u;
  return a + (b - a) * v;
}
