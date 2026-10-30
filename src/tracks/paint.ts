// Paints a whole track into one raster: asphalt, curbs, run-off, barriers,
// rivers, scenery and (for the night track) dithered pools of street light.
// Everything is computed per pixel from the track geometry, so new tracks
// get finished-looking art for free. Bridge decks are painted separately,
// so the overhead view can draw them over the cars passing underneath.
import { Raster, fromMap, hash2, hex, mix, rng, shade, valueNoise, type Palette } from '../art/raster.ts';
import { CURB_WIDTH, WALL_THICKNESS, heightAt, startGrid, pointAt, type DeckSpan, type TrackGeometry } from './geometry.ts';
import { terrainAt, type Terrain } from './terrain.ts';
import { THEMES } from './themes.ts';

export interface Lamp {
  x: number;
  y: number;
}

/**
 * A small upright piece of scenery (tree, cactus, lamp post...). Props are not
 * baked into the ground so the chase camera can keep them standing upright
 * while the world turns; only their shadows are painted on the ground.
 */
export interface Prop {
  /** Sprite name, see propSprite(). */
  name: string;
  /** Top-left corner in world pixels. */
  x: number;
  y: number;
}

export type BlockKind = 'building' | 'mesa' | 'stand';

/**
 * Big scenery (buildings, mesas, grandstands). The overhead view paints its
 * drawing flat; the 3D chase view builds it as a solid instead.
 */
export interface Block {
  kind: BlockKind;
  /** Top-left of the drawing, in world pixels. */
  x: number;
  y: number;
  /**
   * The overhead drawing, seen from above at an angle: its first `topRows`
   * rows are the top (roof, plateau), the rest is the front face.
   */
  art: Raster;
  topRows: number;
}

/** A bridge deck seen from above, for the overhead view (and the deck's top in 3D). */
export interface DeckArt {
  span: DeckSpan;
  /** Top-left in world px; transparent around the deck. */
  x: number;
  y: number;
  raster: Raster;
}

export interface PaintedTrack {
  /** Everything but the bridge decks, for the overhead view (with hill shading). */
  raster: Raster;
  decks: DeckArt[];
  /**
   * The same ground without the blocks and the painted shadows of scenery,
   * for the 3D view, which builds those for real.
   */
  ground: Raster;
  blocks: Block[];
  /** Street lamp heads (night track), used for glow sprites in the race. */
  lamps: Lamp[];
  props: Prop[];
}

/** Which drawings are blocks, and how many of their rows are the top. */
const blockInfo = new WeakMap<Raster, { kind: BlockKind; topRows: number }>();

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither a 0..1 amount into `steps` hard levels. */
function dither(x: number, y: number, amount: number, steps = 4): number {
  const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
  return Math.min(steps, Math.floor(amount * steps + t)) / steps;
}

export function paintTrack(g: TrackGeometry, terrain: Terrain): PaintedTrack {
  const th = THEMES[g.def.theme];
  const { width: Wd, height: Ht, n, ds } = g;
  const L = g.length;
  const W = g.halfWidth;
  const curbOuter = W + CURB_WIDTH;
  const wallIn = g.wallDist;
  const wallOut = wallIn + WALL_THICKNESS;
  const seed = g.def.seed;
  const out = new Raster(Wd, Ht);
  const px = out.px;

  const C = {
    gBase: hex(th.ground.base),
    gPatch: hex(th.ground.patch),
    gDark: hex(th.ground.dark),
    gLight: hex(th.ground.light),
    rA: hex(th.runoff.a),
    rB: hex(th.runoff.b),
    rEdge: hex(th.runoff.edge),
    road: hex(th.road.base),
    roadDark: hex(th.road.dark),
    roadLight: hex(th.road.light),
    line: hex(th.road.line),
    centre: th.road.centre ? hex(th.road.centre) : 0,
    curbA: hex(th.curb[0]),
    curbB: hex(th.curb[1]),
    white: hex('#f4f4f4'),
    black: hex('#1a1c2c'),
    padBase: hex(th.night ? '#2b6f9e' : '#c25a3a'),
    padBright: hex(th.night ? '#73eff7' : '#ffcd75'),
    padBorder: hex('#1a1c2c'),
    pebble: hex('#b98a4a'),
    sand: hex('#e9c27a'),
    pink: hex('#ff4fd8'),
    cyan: hex('#41e6ff'),
    tireHole: hex('#14151f'),
    tireBlack: hex('#2b2e3b'),
    tireRed: hex('#e43b44'),
    tireGap: hex('#2f5a33'),
    rockLight: hex('#d98b4e'),
    rockDark: hex('#8f4f32'),
    rockMid: hex('#b86b40'),
    rockLine: hex('#5d2f25'),
    rockGap: hex('#b48a50'),
    concreteTop: hex('#b8bed4'),
    concrete: hex('#8f95ad'),
    joint: hex('#5b6080'),
    barrierShadow: hex('#14151f'),
    // bridge verges and railings: stone in the meadow, timber in the canyon
    stone: hex('#c2c8d6'),
    stoneDark: hex('#94b0c2'),
    stoneLine: hex('#566c86'),
    plank: hex('#b97a4a'),
    plankDark: hex('#8f5a36'),
    plankLine: hex('#5d3b24'),
    chevron: hex(th.night ? '#73eff7' : '#ffcd75'),
    water: hex('#41a6f6'),
    deep: hex('#3b5dc9'),
    sparkle: hex('#c4f4ff'),
    bank: hex('#e9c27a'),
    wetBank: hex('#c99a55'),
  };
  const flowers = [hex('#f4f4f4'), hex('#ffcd75'), hex('#f47e9b'), hex('#73eff7')];

  // Curbs appear on bends only; everywhere else a painted edge line.
  const curbOn = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.abs(g.curv[i]) > 1 / 230) for (let k = -7; k <= 7; k++) curbOn[(i + k + n) % n] = 1;
  }
  const slots = startGrid(g, 4);
  const pads = g.def.boostPads.map((p) => ({ s: p.at * L, lat: p.lateral }));
  // mud or oil puddles (see game/items.ts): main colour, rim, shine
  const puddles = g.def.puddles.map((q) => ({ ...pointAt(g, q.at * L, q.lateral), r: q.r }));
  const pud = th.puddle.colors.map(hex);
  const wrap = (d: number) => {
    d = ((d % L) + L) % L;
    return d >= L / 2 ? d - L : d;
  };
  const jumps = g.def.jumps.map((jp) => ({ s: jp.at * L, up: jp.up }));

  const ground = (x: number, y: number): number => {
    const h = hash2(x, y, seed);
    if (th.id === 'meadow') {
      const v = valueNoise(x / 46, y / 46, seed);
      let c = v > 0.58 && hash2(x, y, seed + 3) < (v - 0.58) * 5 ? C.gPatch : C.gBase;
      if (h < 0.03) c = C.gDark;
      else if (h > 0.985) c = C.gLight;
      if (hash2(x, y, seed + 7) < 0.003) c = flowers[(hash2(x, y, seed + 9) * 4) | 0];
      return c;
    }
    if (th.id === 'canyon') {
      const v = valueNoise(x / 70, y / 70, seed);
      const ripple = Math.sin(x * 0.09 + y * 0.035 + v * 7);
      let c = ripple > 0.93 ? C.gDark : v > 0.62 && hash2(x, y, seed + 3) < (v - 0.62) * 4 ? C.gPatch : C.gBase;
      if (h < 0.004) c = C.pebble;
      else if (h > 0.993) c = C.gLight;
      return c;
    }
    // city plaza: big paving slabs
    let c = (x % 24 === 0 || y % 24 === 0) ? C.gLight : C.gBase;
    if (h < 0.02) c = C.gDark;
    else if (h > 0.99) c = C.gPatch;
    return c;
  };

  // Colour of a pixel of road, curb, run-off or barrier, `d` px from the
  // centreline near sample i. A bridge deck gets paved verges and a railing.
  const roadColour = (x: number, y: number, i: number, d: number, deck: boolean): number => {
    const k = (i + 1) % n;
    const ax = g.x[i];
    const ay = g.y[i];
    const ex = g.x[k] - ax;
    const ey = g.y[k] - ay;
    const el2 = ex * ex + ey * ey || 1;
    const cx = x + 0.5 - ax;
    const cy = y + 0.5 - ay;
    let t = (cx * ex + cy * ey) / el2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = (i + t) * ds;
    const lat = ex * cy - ey * cx >= 0 ? d : -d;
    let c: number;

    if (d < W) {
      // ---- asphalt
      c = C.road;
      const v = valueNoise(x / 22, y / 22, seed + 5);
      if (v > 0.64 && hash2(x, y, seed + 1) < (v - 0.64) * 4) c = C.roadDark;
      const h = hash2(x, y, seed);
      if (h < 0.05) c = C.roadDark;
      else if (h > 0.97) c = C.roadLight;
      if (!curbOn[i] && d >= W - 3 && d < W - 1.5) c = C.line;
      if (C.centre && Math.abs(lat) < 1 && s % 30 < 15) c = C.centre;
      // chevrons up a jump's ramp, pointing the way to go
      for (const jp of jumps) {
        const dj = wrap(s - jp.s);
        if (dj > -jp.up && dj < -2 && dj > -50 && Math.abs(lat) < W - 6 && (((dj + Math.abs(lat) * 0.7) % 14) + 14) % 14 < 4) c = C.chevron;
        if (dj >= -2 && dj < 0 && Math.abs(lat) < W - 2) c = C.white;
      }
      const ws = wrap(s);
      if (ws >= -3 && ws < 3) c = (Math.floor((ws + 3) / 3) + Math.floor((lat + W) / 3)) & 1 ? C.white : C.black;
      for (const sl of slots) {
        const dd = wrap(s - sl.s);
        const du = Math.abs(lat - sl.lateral);
        if ((dd >= 12 && dd < 14 && du < 8.5) || (dd >= 2 && dd < 14 && du >= 7.5 && du < 8.5)) c = C.line;
      }
      for (const p of pads) {
        const dp = wrap(s - p.s);
        const u = lat - p.lat;
        if (Math.abs(dp) < 13 && Math.abs(u) < 9) {
          if (Math.abs(dp) >= 11.5 || Math.abs(u) >= 7.5) c = C.padBorder;
          else c = (dp + 13 + Math.abs(u) * 0.9) % 8 < 3.2 ? C.padBright : C.padBase;
        }
      }
      for (const q of puddles) {
        const dx = x + 0.5 - q.x;
        const dy = y + 0.5 - q.y;
        const dq = Math.hypot(dx, dy);
        // a wobbly edge, about the size the cars feel it
        const edge = q.r * (0.85 + 0.3 * valueNoise(x / 5, y / 5, seed + 17));
        if (dq > edge) continue;
        c = dq > edge - 1.2 ? pud[1] : dx + dy < -q.r * 0.35 && hash2(x, y, seed + 19) < 0.3 ? pud[2] : pud[0];
      }
    } else if (deck && d < wallIn) {
      // ---- a bridge's verge: stone slabs, timber planks or concrete
      const v = d - curbOuter;
      if (th.id === 'meadow') {
        const row = Math.floor(s / 7);
        c = (s % 7 < 1 || (v + (row & 1) * 5) % 10 < 1) ? C.stoneLine : hash2(row, Math.floor(v / 10), seed) < 0.5 ? C.stone : C.stoneDark;
      } else if (th.id === 'canyon') {
        c = s % 5 < 1 ? C.plankLine : hash2(Math.floor(s / 5), 3, seed) < 0.4 ? C.plankDark : C.plank;
      } else {
        c = s % 10 < 1 || v % 12 < 1 ? C.joint : C.concrete;
      }
      if (d < curbOuter) c = Math.floor(s / 6) & 1 ? C.curbA : C.curbB;
    } else if (deck) {
      // ---- a bridge's railing: a stone parapet, a timber rail on posts, or neon concrete
      const v = d - wallIn;
      if (th.id === 'meadow') c = v < 1 || v >= WALL_THICKNESS - 1 ? C.stoneLine : (s + (Math.floor(v / 3) & 1) * 4) % 8 < 1 ? C.stoneLine : C.stone;
      else if (th.id === 'canyon') c = s % 16 < 3 ? C.plankLine : v > 2 && v < WALL_THICKNESS - 2 ? C.plank : C.plankDark;
      else {
        const neon = Math.floor(s / 48) & 1 ? C.pink : C.cyan;
        c = v < 1.5 ? neon : v < 6.5 ? (v < 2.6 ? C.concreteTop : C.concrete) : C.barrierShadow;
      }
    } else if (d < curbOuter && curbOn[i]) {
      // ---- curb
      c = Math.floor(s / 6) & 1 ? C.curbA : C.curbB;
      if (d >= curbOuter - 1) c = shade(c, -0.3);
    } else if (d < wallIn) {
      // ---- run-off
      const h = hash2(x, y, seed + 11);
      if (th.id === 'meadow') {
        c = Math.floor(s / 16) & 1 ? C.rA : C.rB;
        if (h < 0.04) c = C.rEdge;
      } else if (th.id === 'canyon') {
        c = valueNoise(x / 9, y / 9, seed) > 0.6 ? C.rB : C.rA;
        if (h < 0.05) c = C.rEdge;
        else if (h > 0.985) c = C.sand;
      } else {
        const dd = d - curbOuter;
        const tileEdge = s % 10 < 1 || ((dd % 10) + 10) % 10 < 1;
        c = tileEdge ? C.rEdge : (Math.floor(s / 10) + Math.floor(dd / 10)) & 1 ? C.rA : C.rB;
        // neon from the barrier spills onto the pavement
        const glow = (d - (wallIn - 6)) / 6;
        if (glow > 0) {
          const neon = Math.floor(s / 48) & 1 ? C.pink : C.cyan;
          c = mix(c, neon, 0.45 * dither(x, y, glow * glow, 3));
        }
      }
      if (!curbOn[i] && d < W + 1) c = shade(C.rEdge, -0.15);
      if (d > wallIn - 3) c = shade(c, -0.18);
    } else if (d < wallOut) {
      // ---- barrier
      const v = d - wallIn;
      if (th.wall === 'tires') {
        const q = Math.floor(s / 8);
        const u = (s % 8) - 4;
        const w = v - 4;
        const r2 = u * u + w * w;
        if (r2 < 2.2) c = C.tireHole;
        else if (r2 < 14) {
          c = q % 2 === 0 ? C.tireBlack : q % 4 === 1 ? C.tireRed : C.white;
          if (u + w < -2.6) c = shade(c, 0.25);
          else if (u + w > 2.8) c = shade(c, -0.3);
        } else c = C.tireGap;
      } else if (th.wall === 'rocks') {
        const q = Math.floor(s / 9);
        const rad = 3.6 + hash2(q, 1, seed) * 1.3;
        const cu = 4.5 + (hash2(q, 2, seed) - 0.5) * 1.6;
        const cv = 4 + (hash2(q, 3, seed) - 0.5) * 1.6;
        const u = (s % 9) - cu;
        const w = v - cv;
        const r = Math.sqrt(u * u + w * w);
        if (r < rad - 0.9) {
          c = u + w < -1.5 ? C.rockLight : u + w > 1.8 ? C.rockDark : C.rockMid;
        } else if (r < rad) c = C.rockLine;
        else c = C.rockGap;
      } else {
        const neon = Math.floor(s / 48) & 1 ? C.pink : C.cyan;
        if (v < 1.5) c = neon;
        else if (v < 6.5) {
          c = v < 2.6 ? C.concreteTop : C.concrete;
          if (s % 18 < 1) c = C.joint;
        } else c = C.barrierShadow;
      }
    } else {
      c = ground(x, y);
    }
    return c;
  };

  const riverW = (g.def.river?.width ?? 0) / 2;
  const water = (x: number, y: number, o: number): number => {
    const d = terrain.river ? terrain.river[o] : 255;
    if (d >= riverW + 6) return 0;
    if (d >= riverW + 2) return C.bank;
    if (d >= riverW) return C.wetBank;
    if (d < riverW - 7) return hash2(x, y, seed + 23) < 0.012 ? C.sparkle : C.deep;
    return hash2(x, y, seed + 29) < 0.02 ? C.sparkle : C.water;
  };

  for (let y = 0; y < Ht; y++) {
    for (let x = 0; x < Wd; x++) {
      const o = y * Wd + x;
      const i = g.seg[o];
      px[o] = i < 0 ? water(x, y, o) || ground(x, y) : roadColour(x, y, i, Math.sqrt(g.dist2[o]), false);
    }
  }

  // bridge decks: painted on their own, with the railing on the outside
  const decks: DeckArt[] = g.decks.map((span) => {
    const r = new Raster(span.w, span.h);
    for (let y = 0; y < span.h; y++) {
      for (let x = 0; x < span.w; x++) {
        const o = y * span.w + x;
        const i = span.seg[o];
        if (i < 0) continue;
        const d = Math.sqrt(span.dist2[o]);
        if (d < wallOut) r.px[o] = roadColour(span.x0 + x, span.y0 + y, i, d, true);
      }
    }
    return { span, x: span.x0, y: span.y0, raster: r };
  });

  const scenery = decorate(out, g, terrain);
  hillShade(out, terrain);
  deckShadows(out, g, terrain, decks);
  return { raster: out, decks, ...scenery };
}

/**
 * Shades the overhead picture by the lie of the land, lit from the
 * north-west like everything else: slopes facing the sun lighter, the far
 * sides darker, in dithered steps so it stays pixel art.
 */
function hillShade(out: Raster, t: Terrain): void {
  const { cols, rows, step } = t;
  const lit = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = r * cols + c;
      const gx = (t.h[r * cols + Math.min(cols - 1, c + 1)] - t.h[r * cols + Math.max(0, c - 1)]) / (2 * step);
      const gy = (t.h[Math.min(rows - 1, r + 1) * cols + c] - t.h[Math.max(0, r - 1) * cols + c]) / (2 * step);
      lit[o] = Math.max(-0.22, Math.min(0.22, (0.55 * gx + 0.35 * gy) * 2.5));
    }
  }
  const px = out.px;
  for (let y = 0; y < out.h; y++) {
    const fy = y / step;
    const r = Math.min(rows - 2, Math.floor(fy));
    const v = fy - r;
    for (let x = 0; x < out.w; x++) {
      const fx = x / step;
      const c = Math.min(cols - 2, Math.floor(fx));
      const u = fx - c;
      const o = r * cols + c;
      const a = lit[o] + (lit[o + 1] - lit[o]) * u;
      const b = lit[o + cols] + (lit[o + cols + 1] - lit[o + cols]) * u;
      const l = a + (b - a) * v;
      const q = dither(x, y, Math.abs(l) / 0.22, 4) * 0.22;
      if (q > 0) px[y * out.w + x] = shade(px[y * out.w + x], l > 0 ? q * 0.6 : -q);
    }
  }
}

/** Each deck's shadow on the ground below it, cast away from the sun and further the higher the deck. */
function deckShadows(out: Raster, g: TrackGeometry, t: Terrain, decks: DeckArt[]): void {
  const dark = new Uint8Array(out.w * out.h);
  for (const dk of decks) {
    const { span, raster } = dk;
    for (let y = 0; y < raster.h; y++) {
      for (let x = 0; x < raster.w; x++) {
        const o = y * raster.w + x;
        if (!(raster.px[o] >>> 24)) continue;
        const wx = dk.x + x;
        const wy = dk.y + y;
        const i = span.seg[o];
        const drop = heightAt(g, i * g.ds) - terrainAt(t, wx, wy);
        if (drop < 2) continue;
        const sx = Math.round(wx + drop * 0.69);
        const sy = Math.round(wy + drop * 0.44);
        if (out.inside(sx, sy)) dark[sy * out.w + sx] = 1;
      }
    }
  }
  for (let o = 0; o < dark.length; o++) if (dark[o]) out.px[o] = shade(out.px[o], -0.32);
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

const TREE_PAL: Palette = {
  k: '#1f3a28', H: '#a7f070', G: '#5fc75a', g: '#38b764', d: '#2a8a52', D: '#1e5e43', T: '#a0683f', t: '#6b412a',
};
const ROCK_PAL: Palette = { k: '#33384d', W: '#c2c8d6', w: '#94b0c2', d: '#6f7d96', D: '#566c86' };
const CACTUS_PAL: Palette = { k: '#1d4a3c', H: '#a7f070', G: '#4fc06a', g: '#2f9a5a', d: '#257151', p: '#f47e9b' };
const DESERT_ROCK_PAL: Palette = { k: '#5d2f25', W: '#e8a46b', w: '#d98b4e', d: '#b86b40', D: '#8f4f32' };

const SPRITES: Record<string, { rows: string[]; pal: Palette }> = {
  tree: {
    pal: TREE_PAL,
    rows: [
      '.....kkkkkk.....',
      '...kkGGGGggkk...',
      '..kGGHHGGgggdk..',
      '.kGGHHGGGgggddk.',
      '.kGHHGGGggggddk.',
      'kGGHGGGgggggdddk',
      'kGGGGGgggggddddk',
      'kGGGGgggggdddddk',
      'kgGGggggddddddDk',
      '.kggggggdddddDk.',
      '.kgggdddddddDDk.',
      '..kkdddddddDDk..',
      '....kkkkkkkkk...',
      '......kTtk......',
      '......kTtk......',
      '.....kkkkkk.....',
    ],
  },
  pine: {
    pal: TREE_PAL,
    rows: [
      '......k......',
      '.....kGk.....',
      '....kGGgk....',
      '...kGHGgdk...',
      '....kGgdk....',
      '...kGHggdk...',
      '..kGHGggddk..',
      '...kGggddk...',
      '..kGHgggddk..',
      '.kGHGgggdddk.',
      '..kGgggddDk..',
      '.kGHggggddDk.',
      'kGGgggggdddDk',
      '.kkkkkkkkkkk.',
      '.....kTtk....',
      '.....kkkk....',
    ],
  },
  bush: {
    pal: TREE_PAL,
    rows: ['..kkk.kk..', '.kGGHkGgk.', 'kGHGGGggdk', 'kGGGgggddk', '.kggdddDk.', '..kkkkkk..'],
  },
  rock: {
    pal: ROCK_PAL,
    rows: ['..kkkkk..', '.kWwwwdk.', 'kWwwwwddk', 'kwwwwdddk', 'kwwdddDDk', '.kkkkkkk.'],
  },
  hay: {
    pal: { k: '#6b412a', Y: '#fff3a0', y: '#ffcd75', o: '#e8a14a', O: '#c27a3a' },
    rows: ['..kkkkk..', '.kYyyyok.', 'kYyoyyyok', 'kyyyoyyOk', 'kyoyyyoOk', '.kooOOOk.', '..kkkkk..'],
  },
  cactus: {
    pal: CACTUS_PAL,
    rows: [
      '....kkk....',
      '...kGHgk...',
      '...kGHgk...',
      '.k.kGHgk...',
      'kGkkGHgk.k.',
      'kGgkGHgkkgk',
      'kGgkGHgkGgk',
      'kGgGGHgkGgk',
      '.kkGGHgGGdk',
      '...kGHgkkk.',
      '...kGHgk...',
      '...kGHgk...',
      '...kGHgk...',
      '..kkkkkkk..',
    ],
  },
  barrel: {
    pal: CACTUS_PAL,
    rows: ['..kpk..', '.kGHgk.', 'kGHGgdk', 'kGHGgdk', 'kGGggdk', '.kkkkk.'],
  },
  desertRock: {
    pal: DESERT_ROCK_PAL,
    rows: ['...kkkkk....', '..kWwwwdk...', '.kWwwwwddkk.', 'kWwwwwdddDDk', 'kwwwdddddDDk', 'kddddDDDDDDk', '.kkkkkkkkkk.'],
  },
  weed: {
    pal: { k: '#7a5a3a', o: '#b98a4a' },
    rows: ['.kok.', 'kooko', 'okkoo', 'kooko', '.kok.'],
  },
  planter: {
    pal: { k: '#0f1a1a', G: '#3aa76d', g: '#257151', d: '#1a4f45', z: '#8f95ad', Z: '#5b6080' },
    rows: ['..kkkkk..', '.kGGgggk.', 'kGGgggddk', 'kGgggdddk', '.kgdddddk', 'kzzzzzzzk', 'kZZZZZZZk', 'kkkkkkkkk'],
  },
};

const spriteCache = new Map<string, Raster>();
function sprite(name: string): Raster {
  let r = spriteCache.get(name);
  if (!r) {
    r = name === 'lamp' ? lampPost() : fromMap(SPRITES[name].rows, SPRITES[name].pal);
    spriteCache.set(name, r);
  }
  return r;
}

/** The picture of a prop, for turning props into sprites. */
export function propSprite(name: string): Raster {
  return sprite(name);
}

interface Placed {
  x: number;
  y: number;
  r: Raster;
  shadow: boolean;
  /** Set for upright props, which become sprites instead of being painted. */
  prop?: string;
}

function decorate(out: Raster, g: TrackGeometry, terrain: Terrain): { lamps: Lamp[]; props: Prop[]; blocks: Block[]; ground: Raster } {
  const th = THEMES[g.def.theme];
  const ground = out.clone();
  const R = rng(g.def.seed * 7919 + 1);
  const { width: Wd, height: Ht } = g;
  const clear = g.wallDist + WALL_THICKNESS + 3;
  const clear2 = clear * clear;
  const CELL = 4;
  const occW = Math.ceil(Wd / CELL);
  const occ = new Uint8Array(occW * Math.ceil(Ht / CELL));
  const placed: Placed[] = [];

  const riverClear = (g.def.river?.width ?? 0) / 2 + 10;
  /** Road, a bridge deck (and the ground under it) or water here. */
  const taken = (x: number, y: number, o: number): boolean => {
    if (g.seg[o] >= 0 && g.dist2[o] < clear2) return true;
    if (terrain.river && terrain.river[o] < riverClear) return true;
    for (const d of g.decks) {
      const lx = x - d.x0;
      const ly = y - d.y0;
      if (lx < 0 || ly < 0 || lx >= d.w || ly >= d.h) continue;
      const k = ly * d.w + lx;
      if (d.seg[k] >= 0 && d.dist2[k] < clear2) return true;
    }
    return false;
  };
  const free = (x0: number, y0: number, w: number, h: number, pad = 2): boolean => {
    if (x0 < 2 || y0 < 2 || x0 + w > Wd - 2 || y0 + h > Ht - 2) return false;
    for (let y = y0 - pad; y <= y0 + h + pad; y += 3) {
      for (let x = x0 - pad; x <= x0 + w + pad; x += 3) {
        const xx = Math.min(Wd - 1, Math.max(0, x));
        const yy = Math.min(Ht - 1, Math.max(0, y));
        if (taken(xx, yy, yy * Wd + xx)) return false;
        if (occ[((yy / CELL) | 0) * occW + ((xx / CELL) | 0)]) return false;
      }
    }
    return true;
  };
  const claim = (x0: number, y0: number, w: number, h: number) => {
    for (let y = Math.max(0, y0); y < Math.min(Ht, y0 + h); y += 2)
      for (let x = Math.max(0, x0); x < Math.min(Wd, x0 + w); x += 2) occ[((y / CELL) | 0) * occW + ((x / CELL) | 0)] = 1;
  };
  /** Scatters up to `max` copies of a sprite (or freshly generated sprites) on free ground. */
  const tryPlace = (make: Raster | (() => Raster), max: number, shadow = true, pad = 2, attemptsPer = 8, prop?: string): number => {
    let count = 0;
    for (let a = 0; a < max * attemptsPer && count < max; a++) {
      const r = typeof make === 'function' ? make() : make;
      const x = Math.floor(R() * (Wd - r.w));
      const y = Math.floor(R() * (Ht - r.h));
      if (!free(x, y, r.w, r.h, pad)) continue;
      claim(x, y, r.w, r.h);
      placed.push({ x, y, r, shadow, prop });
      count++;
    }
    return count;
  };
  const placeProp = (name: string, max: number, shadow = true) => tryPlace(sprite(name), max, shadow, 2, 8, name);

  const area = (Wd * Ht) / 1e6;
  const lamps: Lamp[] = [];

  // A grandstand beside the start straight, wherever it fits first.
  const stand = grandstand(th.id === 'city' ? 'city' : th.id === 'canyon' ? 'wood' : 'meadow', R);
  standSearch: for (const s of [40, 80, 0, 120, -40, 160]) {
    for (const gap of [4, 10, 18]) {
      for (const side of [-1, 1]) {
        const p = pointAt(g, s, side * (clear + gap + stand.h / 2));
        const x = Math.round(p.x - stand.w / 2);
        const y = Math.round(p.y - stand.h / 2);
        if (free(x, y, stand.w, stand.h, 1)) {
          claim(x, y, stand.w, stand.h);
          placed.push({ x, y, r: stand, shadow: true });
          break standSearch;
        }
      }
    }
  }

  if (th.id === 'meadow') {
    tryPlace(() => pondSprite(60 + R() * 40, 34 + R() * 20, R), 2, false, 6, 30);
    placeProp('tree', Math.round(150 * area));
    placeProp('pine', Math.round(60 * area));
    placeProp('bush', Math.round(110 * area));
    placeProp('hay', Math.round(14 * area));
    placeProp('rock', Math.round(24 * area));
  } else if (th.id === 'canyon') {
    tryPlace(() => mesaSprite(50 + R() * 50, 26 + R() * 18, 10 + R() * 8, R), Math.round(4 * area), true, 6, 20);
    placeProp('cactus', Math.round(70 * area));
    placeProp('barrel', Math.round(50 * area));
    placeProp('desertRock', Math.round(50 * area));
    placeProp('weed', Math.round(40 * area), false);
  } else {
    // street lamps hug the barriers, then buildings fill the blocks
    const lampSprite = sprite('lamp');
    const step = 120;
    for (let s = 40, side = 1; s < g.length; s += step, side = -side) {
      for (const sd of [side, -side]) {
        const p = pointAt(g, s, sd * (clear + 3));
        const x = Math.round(p.x - lampSprite.w / 2);
        const y = Math.round(p.y - lampSprite.h + 2);
        if (free(x, y, lampSprite.w, lampSprite.h, 0)) {
          claim(x, y, lampSprite.w, lampSprite.h);
          placed.push({ x, y, r: lampSprite, shadow: false, prop: 'lamp' });
          const glow = pointAt(g, s, sd * (clear - 22));
          lamps.push({ x: glow.x, y: glow.y });
          break;
        }
      }
    }
    const block = () => building(40 + Math.floor(R() * 52), 24 + Math.floor(R() * 34), 12 + Math.floor(R() * 16), R);
    tryPlace(block, Math.round(80 * area), true, 3, 6);
    placeProp('planter', Math.round(60 * area));
  }

  placed.sort((a, b) => a.y + a.r.h - (b.y + b.r.h));
  const shadowC = th.night ? 0x70000000 : 0x55000000;
  for (const p of placed) if (p.shadow) out.blit(p.r.silhouette(shadowC >>> 0), p.x + 3, p.y + 2);
  const props: Prop[] = [];
  const blocks: Block[] = [];
  for (const p of placed) {
    if (p.prop) {
      props.push({ name: p.prop, x: p.x, y: p.y });
      continue;
    }
    out.blit(p.r, p.x, p.y);
    const info = blockInfo.get(p.r);
    if (info) blocks.push({ kind: info.kind, x: p.x, y: p.y, art: p.r, topRows: info.topRows });
    // flat things (ponds) belong to the ground in both views
    else ground.blit(p.r, p.x, p.y);
  }

  if (th.night) {
    lightPools(out, lamps);
    lightPools(ground, lamps);
  }
  return { lamps, props, blocks, ground };
}

function pondSprite(w: number, h: number, R: () => number): Raster {
  w = Math.round(w);
  h = Math.round(h);
  const r = new Raster(w, h);
  const water = hex('#41a6f6');
  const deep = hex('#3b5dc9');
  const rim = hex('#e9c27a');
  const sparkle = hex('#c4f4ff');
  const seed = Math.floor(R() * 1000);
  const inside = (x: number, y: number) => {
    const dx = (x + 0.5 - w / 2) / (w / 2);
    const dy = (y + 0.5 - h / 2) / (h / 2);
    return dx * dx + dy * dy + (valueNoise(x / 9, y / 9, seed) - 0.5) * 0.5 < 0.82;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const edge2 = !inside(x - 2, y) || !inside(x + 2, y) || !inside(x, y - 2) || !inside(x, y + 2);
      let c = edge ? rim : edge2 ? deep : water;
      if (!edge && !edge2 && hash2(x, y, seed) < 0.02) c = sparkle;
      r.set(x, y, c);
    }
  }
  return r;
}

function mesaSprite(w: number, topH: number, cliffH: number, R: () => number): Raster {
  w = Math.round(w);
  topH = Math.round(topH);
  cliffH = Math.round(cliffH);
  const h = topH + cliffH;
  const r = new Raster(w, h);
  const seed = Math.floor(R() * 1000);
  const top = hex('#e09a5b');
  const topLight = hex('#f0b678');
  const cliff = hex('#b0603e');
  const cliffDark = hex('#8a4632');
  const line = hex('#5d2f25');
  const shapeW = (y: number) => {
    // wobbly outline, narrower at the very top and bottom
    const n = valueNoise(y / 6, 0.5, seed);
    return w / 2 - 2 - n * 5;
  };
  for (let y = 0; y < h; y++) {
    const half = shapeW(y) - (y < 3 ? 3 - y : 0);
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x + 0.5 - w / 2);
      if (dx > half) continue;
      let c: number;
      if (y < topH) c = valueNoise(x / 7, y / 7, seed) > 0.6 ? topLight : top;
      else c = (x + Math.floor(valueNoise(x / 3, 0, seed) * 3)) % 5 === 0 ? cliffDark : cliff;
      if (dx > half - 1 || y === 0 || y === h - 1 || y === topH) c = line;
      r.set(x, y, c);
    }
  }
  blockInfo.set(r, { kind: 'mesa', topRows: topH });
  return r;
}

function grandstand(kind: 'meadow' | 'wood' | 'city', R: () => number): Raster {
  const w = 120;
  const h = 34;
  const r = new Raster(w, h);
  const k = hex('#1a1c2c');
  const roofA = hex(kind === 'city' ? '#ff4fd8' : kind === 'wood' ? '#ef7d57' : '#e43b44');
  const roofB = hex('#f4f4f4');
  const seat = hex(kind === 'wood' ? '#a0683f' : kind === 'city' ? '#3a3f5c' : '#566c86');
  const seatDark = shade(seat, -0.3);
  const crowd = ['#ffcd75', '#f47e9b', '#73eff7', '#a7f070', '#f4f4f4', '#ef7d57', '#c3a6ff', '#41a6f6'].map(hex);
  r.fillRect(0, 0, w, h, k);
  // striped roof
  for (let y = 1; y < 9; y++) for (let x = 1; x < w - 1; x++) r.set(x, y, Math.floor(x / 6) & 1 ? roofA : roofB);
  for (let x = 1; x < w - 1; x++) r.set(x, 9, shade(roofA, -0.4));
  // tiers of seats with a cheering crowd
  for (let y = 10; y < h - 3; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tier = (y - 10) % 4;
      let c = tier === 3 ? seatDark : seat;
      if (tier < 2 && x % 3 !== 0 && R() < 0.8) c = crowd[Math.floor(R() * crowd.length)];
      r.set(x, y, c);
    }
  }
  r.fillRect(1, h - 3, w - 2, 2, hex('#c2c8d6'));
  blockInfo.set(r, { kind: 'stand', topRows: 10 });
  return r;
}

function building(w: number, roofH: number, facadeH: number, R: () => number): Raster {
  const h = roofH + facadeH;
  const r = new Raster(w, h);
  const schemes = [
    ['#4b3f72', '#3a3160', '#2a2350'],
    ['#2f4a6d', '#263d5b', '#1c2e47'],
    ['#3d5a5a', '#2f4848', '#213636'],
    ['#5a3f5a', '#4a3149', '#382439'],
  ];
  const [roof, wall, dark] = schemes[Math.floor(R() * schemes.length)].map(hex);
  const outline = hex('#0d0e1a');
  const lit = [hex('#ffe9a8'), hex('#ffcd75'), hex('#73eff7'), hex('#ff79c6')];
  r.fillRect(0, 0, w, h, outline);
  r.fillRect(1, 1, w - 2, roofH - 1, roof);
  r.fillRect(2, 2, w - 4, 1, shade(roof, 0.15));
  // roof clutter: AC units, vents, a water tank
  for (let k = 0; k < 2 + Math.floor(R() * 3); k++) {
    const bx = 3 + Math.floor(R() * (w - 12));
    const by = 4 + Math.floor(R() * Math.max(1, roofH - 10));
    r.fillRect(bx, by, 6, 4, hex('#8f95ad'));
    r.fillRect(bx, by + 3, 6, 1, hex('#5b6080'));
    r.fillRect(bx + 1, by + 1, 2, 2, hex('#5b6080'));
  }
  if (R() < 0.4) r.fillCircle(w - 9, roofH - 8, 4, hex('#a0683f'));
  // facade with windows
  r.fillRect(1, roofH, w - 2, facadeH - 1, wall);
  r.fillRect(1, roofH, w - 2, 1, dark);
  for (let y = roofH + 3; y < h - 4; y += 5) {
    for (let x = 3; x < w - 4; x += 5) {
      const c = R() < 0.5 ? lit[Math.floor(R() * lit.length)] : dark;
      r.fillRect(x, y, 3, 3, c);
    }
  }
  // the odd neon sign
  if (R() < 0.5 && w > 46) {
    const sw = 14 + Math.floor(R() * 12);
    const sx = Math.floor((w - sw) / 2);
    const col = [hex('#ff4fd8'), hex('#41e6ff'), hex('#a7f070')][Math.floor(R() * 3)];
    r.fillRect(sx - 1, roofH + 1, sw + 2, 5, shade(col, -0.55));
    r.fillRect(sx, roofH + 2, sw, 3, col);
  }
  blockInfo.set(r, { kind: 'building', topRows: roofH });
  return r;
}

function lampPost(): Raster {
  return fromMap(
    ['.kkk.', 'kYYYk', '.kkk.', '..k..', '..d..', '..d..', '..d..', '..d..', '.kdk.', '.kkk.'],
    { k: '#14151f', Y: '#fff3a0', d: '#8f95ad' },
  );
}

function lightPools(out: Raster, lamps: Lamp[]): void {
  const warm = hex('#ffe9a8');
  const rad = 46;
  for (const l of lamps) {
    for (let y = Math.floor(l.y - rad); y <= l.y + rad; y++) {
      for (let x = Math.floor(l.x - rad); x <= l.x + rad; x++) {
        if (!out.inside(x, y)) continue;
        const d = Math.hypot(x + 0.5 - l.x, (y + 0.5 - l.y) * 1.15) / rad;
        if (d >= 1) continue;
        const a = dither(x, y, Math.pow(1 - d, 1.4), 4) * 0.38;
        if (a <= 0) continue;
        const o = y * out.w + x;
        out.px[o] = mix(out.px[o], warm, a);
      }
    }
  }
}
