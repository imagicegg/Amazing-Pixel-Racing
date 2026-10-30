// Track geometry: a closed centripetal Catmull-Rom spline resampled at even
// spacing, plus a per-pixel "nearest centreline sample" field. The field
// lets the painter and the scenery answer "which part of the track is
// here?" in constant time. Cars ask probeNear() instead, which follows their
// own stretch of road, so a car under a bridge never mistakes the road
// above it for its own.
//
// The road also has a height: a smooth profile along the lap with jumps
// built in. Bridge decks are the stretches of road that cross over
// something; they are left out of the ground field (the painter draws what
// is under them) and get small fields of their own.
import type { TrackDef } from './tracks.ts';

/** Distance between centreline samples, in world pixels. */
export const SAMPLE_SPACING = 6;
/** Width of the coloured curb / white edge line outside the asphalt. */
export const CURB_WIDTH = 4;
/** Thickness of the barrier drawn beyond the run-off area. */
export const WALL_THICKNESS = 8;
/** The road's height profile is stored every this many px of arc length. */
const PROFILE_STEP = 1;

/**
 * A stretch of road carried on a bridge deck: the segments starting at
 * samples a..b-1 (b may run past n; indices wrap). It has its own "nearest
 * deck sample" field over its bounding box, with both ends cut square.
 */
export interface DeckSpan {
  a: number;
  b: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Per pixel of the box: nearest deck sample, or -1. */
  seg: Int32Array;
  /** Per pixel of the box: squared distance to the deck's centreline. */
  dist2: Float32Array;
}

/** Where a bridge deck begins or ends: the side the normal points to is cut away. */
export interface Cut {
  /** The sample the cut runs through, and its place on the centreline. */
  i: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface TrackGeometry {
  def: TrackDef;
  width: number;
  height: number;
  n: number;
  ds: number;
  length: number;
  x: Float32Array;
  y: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  /** Smoothed signed curvature in 1/px; positive means the road bends right. */
  curv: Float32Array;
  halfWidth: number;
  /** Distance from the centreline where the barrier starts. */
  wallDist: number;
  /**
   * Per world pixel: index of the nearest centreline sample on the ground
   * (bridge decks left out), or -1 when far from the track.
   */
  seg: Int32Array;
  /** Per world pixel: squared distance to the centreline (valid where seg >= 0). */
  dist2: Float32Array;
  /** Road height above the plain at each sample, px. */
  h: Float32Array;
  /** Road height every PROFILE_STEP px along the lap (see heightAt). */
  profile: Float32Array;
  /** Per sample: 1 when the segment starting there is carried on a bridge deck. */
  deck: Uint8Array;
  /** The decks' sample ranges [a, b) (b may run past n), in lap order. */
  spans: [number, number][];
  /** The decks with their fields (only when the field was built). */
  decks: DeckSpan[];
}

export interface Probe {
  /** Segment start sample. */
  i: number;
  /** Position along the segment, 0..1. */
  t: number;
  /** Arc length from the start line. */
  s: number;
  dist: number;
  /** Signed offset from the centreline, positive = right of the driving direction. */
  lateral: number;
  /** Unit vector from the nearest centreline point towards the probed point. */
  nx: number;
  ny: number;
}

type Pt = [number, number];

function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps: number, out: Pt[]): void {
  const knot = (a: Pt, b: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  for (let k = 0; k < steps; k++) {
    const t = t1 + ((t2 - t1) * k) / steps;
    const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
      const u = (t - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    };
    const a1 = lerp(p0, p1, t0, t1);
    const a2 = lerp(p1, p2, t1, t2);
    const a3 = lerp(p2, p3, t2, t3);
    const b1 = lerp(a1, a2, t0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    out.push(lerp(b1, b2, t1, t2));
  }
}

/**
 * Builds the centreline and, unless `withField` is false, the per-pixel
 * lookup field (the expensive part; menus only need the outline).
 */
export function buildGeometry(def: TrackDef, withField = true): TrackGeometry {
  const pts = def.points;
  const m = pts.length;
  const dense: Pt[] = [];
  for (let i = 0; i < m; i++) {
    catmullRom(pts[(i - 1 + m) % m], pts[i], pts[(i + 1) % m], pts[(i + 2) % m], 48, dense);
  }
  // cumulative length of the dense polyline (closed)
  const cum = new Float64Array(dense.length + 1);
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % dense.length];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const total = cum[dense.length];
  const n = Math.round(total / SAMPLE_SPACING);
  const ds = total / n;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    x[i] = a[0] + (b[0] - a[0]) * u;
    y[i] = a[1] + (b[1] - a[1]) * u;
  }
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l;
    ty[i] = dy / l;
  }
  let curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    let d = Math.atan2(ty[b], tx[b]) - Math.atan2(ty[a], tx[a]);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curv[i] = d / (2 * ds);
  }
  for (let pass = 0; pass < 3; pass++) {
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += curv[(i + k + n) % n];
      sm[i] = acc / 7;
    }
    curv = sm;
  }

  const [width, height] = def.size;
  const halfWidth = def.halfWidth;
  const wallDist = halfWidth + CURB_WIDTH + def.runoff;
  const band = wallDist + WALL_THICKNESS + 6;

  const profile = heightProfile(def, total);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = profileAt(profile, total, i * ds);
  const deck = new Uint8Array(n);
  const spans: [number, number][] = def.bridges.map(([from, to]) => {
    const a = Math.round(from * n);
    let b = Math.round(to * n);
    if (b <= a) b += n;
    for (let i = a; i < b; i++) deck[i % n] = 1;
    return [a, b];
  });

  const cells = withField ? width * height : 0;
  const seg = new Int32Array(cells).fill(-1);
  const dist2 = new Float32Array(cells).fill(Infinity);
  const geom: TrackGeometry = { def, width, height, n, ds, length: total, x, y, tx, ty, curv, halfWidth, wallDist, seg, dist2, h, profile, deck, spans, decks: [] };
  if (!withField) return geom;
  // the ground: every segment but the decks, cut square where a deck begins or ends
  const reach = Math.ceil(band / ds) + 3;
  for (let i = 0; i < n; i++) {
    if (deck[i]) continue;
    rasterSegment(geom, i, band, 0, 0, width, height, seg, dist2, cutsFor(geom, i, reach));
  }
  for (const [a, b] of spans) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = a; k <= b; k++) {
      const i = k % n;
      minX = Math.min(minX, x[i]);
      maxX = Math.max(maxX, x[i]);
      minY = Math.min(minY, y[i]);
      maxY = Math.max(maxY, y[i]);
    }
    const x0 = Math.max(0, Math.floor(minX - band));
    const y0 = Math.max(0, Math.floor(minY - band));
    const w = Math.min(width, Math.ceil(maxX + band)) - x0;
    const hh = Math.min(height, Math.ceil(maxY + band)) - y0;
    const span: DeckSpan = { a, b, x0, y0, w, h: hh, seg: new Int32Array(w * hh).fill(-1), dist2: new Float32Array(w * hh).fill(Infinity) };
    for (let k = a; k < b; k++) rasterSegment(geom, k % n, band, x0, y0, w, hh, span.seg, span.dist2, cutsFor(geom, k % n, reach));
    geom.decks.push(span);
  }
  return geom;
}

/**
 * The cuts that apply to segment i: a road leading onto a deck stops at the
 * deck's start, one leading off it starts at the deck's end, and a deck
 * stays between its own ends. Only segments within `reach` samples of a cut
 * are affected (a long curving deck mustn't be clipped by its far end).
 */
export function cutsFor(g: TrackGeometry, i: number, reach: number): Cut[] {
  const n = g.n;
  const out: Cut[] = [];
  const cut = (c: number, sign: number): Cut => {
    const k = c % n;
    return { i: k, x: g.x[k], y: g.y[k], nx: sign * g.tx[k], ny: sign * g.ty[k] };
  };
  for (const [a, b] of g.spans) {
    // how far into this deck segment i is, in samples
    const into = (((i - a) % n) + n) % n;
    if (into < b - a) {
      if (into <= reach) out.push(cut(a, -1));
      if (b - a - into <= reach) out.push(cut(b, 1));
    } else if (!g.deck[i]) {
      // samples from i forward to the deck's start, and from its end forward to i
      const toStart = n - into;
      const fromEnd = (((i - b) % n) + n) % n;
      if (toStart <= reach) out.push(cut(a, 1));
      if (fromEnd < reach) out.push(cut(b, -1));
    }
  }
  return out;
}

/**
 * Writes segment i into a nearest-sample field covering the box (x0, y0,
 * w, h), leaving out whatever lies past its cuts, so a road ends square
 * where a bridge deck takes over.
 */
function rasterSegment(g: TrackGeometry, i: number, band: number, x0: number, y0: number, w: number, h: number, seg: Int32Array, dist2: Float32Array, cuts: Cut[]): void {
  const n = g.n;
  const ax = g.x[i];
  const ay = g.y[i];
  const bx = g.x[(i + 1) % n];
  const by = g.y[(i + 1) % n];
  const ex = bx - ax;
  const ey = by - ay;
  const el2 = ex * ex + ey * ey || 1;
  const band2 = band * band;
  const minX = Math.max(x0, Math.floor(Math.min(ax, bx) - band));
  const maxX = Math.min(x0 + w - 1, Math.ceil(Math.max(ax, bx) + band));
  const minY = Math.max(y0, Math.floor(Math.min(ay, by) - band));
  const maxY = Math.min(y0 + h - 1, Math.ceil(Math.max(ay, by) + band));
  for (let py = minY; py <= maxY; py++) {
    const cy = py + 0.5;
    let o = (py - y0) * w + (minX - x0);
    for (let px = minX; px <= maxX; px++, o++) {
      const cx = px + 0.5;
      if (cuts.length && cuts.some((c) => (cx - c.x) * c.nx + (cy - c.y) * c.ny > 0)) continue;
      let t = ((cx - ax) * ex + (cy - ay) * ey) / el2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - cx;
      const qy = ay + ey * t - cy;
      const d2 = qx * qx + qy * qy;
      if (d2 < band2 && d2 < dist2[o]) {
        dist2[o] = d2;
        seg[o] = i;
      }
    }
  }
}

/**
 * The road's height every PROFILE_STEP px of the lap: the elevation points
 * joined by a periodic monotone cubic (Fritsch-Carlson), so it never
 * overshoots and a hill's top is level, plus the jumps' kickers.
 */
function heightProfile(def: TrackDef, L: number): Float32Array {
  const out = new Float32Array(Math.ceil(L / PROFILE_STEP) + 2);
  // knots in lap order, at distinct places, repeated a lap before and after
  const pts = def.elevation
    .map(([at, hgt]) => [(((at % 1) + 1) % 1) * L, hgt] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, k, all) => k === 0 || p[0] - all[k - 1][0] > 1e-6);
  const m = pts.length;
  if (m > 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = -2; k < m + 2; k++) {
      const wrap = Math.floor(k / m);
      const p = pts[k - wrap * m];
      xs.push(p[0] + wrap * L);
      ys.push(p[1]);
    }
    const sec = xs.slice(0, -1).map((xk, k) => (ys[k + 1] - ys[k]) / (xs[k + 1] - xk));
    const d = xs.map((_, k) => {
      if (k === 0 || k === xs.length - 1 || sec[k - 1] * sec[k] <= 0) return 0;
      const h0 = xs[k] - xs[k - 1];
      const h1 = xs[k + 1] - xs[k];
      const w1 = 2 * h1 + h0;
      const w2 = h1 + 2 * h0;
      return (w1 + w2) / (w1 / sec[k - 1] + w2 / sec[k]);
    });
    let k = 0;
    for (let j = 0; j < out.length; j++) {
      const s = j * PROFILE_STEP;
      while (xs[k + 1] <= s) k++;
      const hk = xs[k + 1] - xs[k];
      const t = (s - xs[k]) / hk;
      const t2 = t * t;
      const t3 = t2 * t;
      out[j] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * hk * d[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * hk * d[k + 1];
    }
  } else if (m === 1) out.fill(pts[0][1]);
  // kickers: steepest at the lip, easing out at both feet
  for (const jp of def.jumps) {
    const lip = jp.at * L;
    for (let j = 0; j < out.length; j++) {
      // the nearest copy of the lip, a lap either way
      let ds = j * PROFILE_STEP - lip;
      ds -= Math.round(ds / L) * L;
      if (ds > -jp.up && ds <= 0) out[j] += jp.h * ((ds + jp.up) / jp.up) ** 2;
      else if (ds > 0 && ds < jp.down) out[j] += jp.h * (1 - ds / jp.down) ** 2;
    }
  }
  return out;
}

function profileAt(p: Float32Array, L: number, s: number): number {
  s = ((s % L) + L) % L;
  const f = s / PROFILE_STEP;
  const k = Math.floor(f);
  return p[k] + (p[k + 1] - p[k]) * (f - k);
}

/** Height of the road above the plain at arc length s (wraps around), px. */
export function heightAt(g: TrackGeometry, s: number): number {
  return profileAt(g.profile, g.length, s);
}

/** How steeply the road climbs at arc length s, in the driving direction: height gained per px. */
export function gradeAt(g: TrackGeometry, s: number): number {
  const L = g.length;
  const k = Math.floor((((s % L) + L) % L) / PROFILE_STEP);
  return (g.profile[k + 1] - g.profile[k]) / PROFILE_STEP;
}

/** The bridge deck that sample i belongs to, if any. */
export function deckOf(g: TrackGeometry, i: number): DeckSpan | null {
  if (!g.deck[((i % g.n) + g.n) % g.n]) return null;
  for (const d of g.decks) {
    const k = ((i - d.a) % g.n + g.n) % g.n;
    if (k < d.b - d.a) return d;
  }
  return null;
}

function project(g: TrackGeometry, i: number, px: number, py: number, out: Probe): number {
  const n = g.n;
  i = ((i % n) + n) % n;
  const k = (i + 1) % n;
  const ax = g.x[i];
  const ay = g.y[i];
  const ex = g.x[k] - ax;
  const ey = g.y[k] - ay;
  const el2 = ex * ex + ey * ey || 1;
  let t = ((px - ax) * ex + (py - ay) * ey) / el2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + ex * t;
  const cy = ay + ey * t;
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  out.i = i;
  out.t = t;
  // Arc length by the tangents interpolated along the segment, so it runs
  // smoothly round bends: on the outside of a bend the plain nearest point
  // sticks at each corner of the polyline for a moment, and a car's height
  // (read from the arc length) would stutter on a slope.
  const tax = g.tx[i];
  const tay = g.ty[i];
  const dtx = g.tx[k] - tax;
  const dty = g.ty[k] - tay;
  const rx = px - ax;
  const ry = py - ay;
  const qa = -(ex * dtx + ey * dty);
  const qb = rx * dtx + ry * dty - (ex * tax + ey * tay);
  const qc = rx * tax + ry * tay;
  let u = qb !== 0 ? -qc / qb : t;
  for (let it = 0; it < 2; it++) {
    const df = 2 * qa * u + qb;
    if (df !== 0) u -= ((qa * u + qb) * u + qc) / df;
  }
  if (!(u > -1 && u < 2)) u = t;
  out.s = (i + u) * g.ds;
  out.dist = d;
  const len = Math.sqrt(el2);
  out.lateral = (ex * dy - ey * dx) / len >= 0 ? d : -d;
  out.nx = d > 1e-6 ? dx / d : 0;
  out.ny = d > 1e-6 ? dy / d : 0;
  return d;
}

/** Exact nearest point on the centreline. Reuses `out` to avoid garbage. */
export function probe(g: TrackGeometry, px: number, py: number, out: Probe = newProbe()): Probe {
  const ix = Math.min(g.width - 1, Math.max(0, px | 0));
  const iy = Math.min(g.height - 1, Math.max(0, py | 0));
  const hint = g.seg[iy * g.width + ix];
  const tmp = scratch;
  let best = Infinity;
  if (hint >= 0) {
    for (let k = -2; k <= 2; k++) {
      const d = project(g, hint + k, px, py, tmp);
      if (d < best) {
        best = d;
        Object.assign(out, tmp);
      }
    }
  } else {
    // Far from the road (should not happen thanks to the barriers): scan everything.
    for (let i = 0; i < g.n; i++) {
      const d = project(g, i, px, py, tmp);
      if (d < best) {
        best = d;
        Object.assign(out, tmp);
      }
    }
  }
  return out;
}

/**
 * Nearest point on the stretch of centreline around sample `hint`: walks
 * from the hint to the closest segment. Cars use this with the sample they
 * were at last step, so they follow their own road through a crossing (the
 * ground field would hand them whichever road is nearer).
 */
export function probeNear(g: TrackGeometry, px: number, py: number, hint: number, out: Probe = newProbe()): Probe {
  const n = g.n;
  const tmp = scratch;
  let i = ((hint % n) + n) % n;
  let d = project(g, i, px, py, tmp);
  let moved = false;
  for (let k = 0; k < 80; k++) {
    const j = (i + 1) % n;
    const dj = project(g, j, px, py, tmp);
    if (dj >= d) break;
    i = j;
    d = dj;
    moved = true;
  }
  for (let k = 0; !moved && k < 80; k++) {
    const j = (i - 1 + n) % n;
    const dj = project(g, j, px, py, tmp);
    if (dj >= d) break;
    i = j;
    d = dj;
  }
  let best = Infinity;
  for (let k = -2; k <= 2; k++) {
    const dk = project(g, i + k, px, py, tmp);
    if (dk < best) {
      best = dk;
      Object.assign(out, tmp);
    }
  }
  return out;
}

const scratch = newProbe();

export function newProbe(): Probe {
  return { i: 0, t: 0, s: 0, dist: 0, lateral: 0, nx: 0, ny: 0 };
}

export interface TrackPoint {
  x: number;
  y: number;
  /** Unit tangent (driving direction). */
  tx: number;
  ty: number;
  /** Heading angle in radians. */
  angle: number;
}

/** Point at arc length s (wraps around) shifted sideways by `lateral` px (positive = right). */
export function pointAt(g: TrackGeometry, s: number, lateral = 0): TrackPoint {
  const L = g.length;
  s = ((s % L) + L) % L;
  const f = s / g.ds;
  const i = Math.floor(f) % g.n;
  const k = (i + 1) % g.n;
  const u = f - Math.floor(f);
  const x = g.x[i] + (g.x[k] - g.x[i]) * u;
  const y = g.y[i] + (g.y[k] - g.y[i]) * u;
  let tx = g.tx[i] + (g.tx[k] - g.tx[i]) * u;
  let ty = g.ty[i] + (g.ty[k] - g.ty[i]) * u;
  const l = Math.hypot(tx, ty) || 1;
  tx /= l;
  ty /= l;
  return { x: x - ty * lateral, y: y + tx * lateral, tx, ty, angle: Math.atan2(ty, tx) };
}

/** Curvature at arc length s. */
export function curvatureAt(g: TrackGeometry, s: number): number {
  const i = Math.floor((((s % g.length) + g.length) % g.length) / g.ds) % g.n;
  return g.curv[i];
}

/** Wraps an arc-length difference into [-L/2, L/2). */
export function wrapS(g: TrackGeometry, d: number): number {
  const L = g.length;
  d = ((d % L) + L) % L;
  return d >= L / 2 ? d - L : d;
}

export interface GridSlot extends TrackPoint {
  s: number;
  lateral: number;
}

/** Staggered two-column starting grid behind the start line; slot 0 is pole position. */
export function startGrid(g: TrackGeometry, count: number): GridSlot[] {
  const out: GridSlot[] = [];
  for (let k = 0; k < count; k++) {
    const row = Math.floor(k / 2);
    const side = k % 2 === 0 ? -1 : 1;
    const s = -(24 + row * 36 + (k % 2) * 16);
    const lateral = side * g.halfWidth * 0.42;
    out.push({ ...pointAt(g, s, lateral), s, lateral });
  }
  return out;
}
