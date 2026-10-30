// The 3D chase view's big scenery, built from what the overhead painter
// placed: barriers along the walls, and buildings, mesas and grandstands made
// solid. Pure code: rasters, voxel grids and positions for ChaseView3D to
// turn into meshes.
import { Raster, hash2, hex, mix, rng, shade } from '../art/raster.ts';
import { VoxelGrid } from '../art/voxel.ts';
import { WALL_THICKNESS, deckOf, heightAt, pointAt, probe, wrapS, type TrackGeometry } from './geometry.ts';
import type { Block } from './paint.ts';

// ---------------------------------------------------------------------------
// Barriers
// ---------------------------------------------------------------------------

export interface BarrierSpot {
  x: number;
  y: number;
  /** Direction along the wall, radians. */
  angle: number;
  /** Arc length along the track, for colour patterns. */
  s: number;
  /** +1 right of the road, -1 left. */
  side: number;
  /** Height of the road it stands beside. */
  z: number;
  /** On a bridge deck: a railing rather than a barrier. */
  deck: boolean;
}

/**
 * Evenly spaced spots along the middle of both barrier bands. Spots are
 * dropped where the band belongs to another part of the track (inside tight
 * bends), so the 3D barriers follow the painted ones. On bridge decks they
 * are checked against the deck's own field, and become its railings.
 */
export function barrierSpots(g: TrackGeometry, spacing: number): BarrierSpot[] {
  const out: BarrierSpot[] = [];
  const offset = g.wallDist + WALL_THICKNESS / 2;
  for (const side of [-1, 1]) {
    let walked = spacing / 2;
    let prev = pointAt(g, 0, side * offset);
    for (let s = 1; s <= g.length; s += 1) {
      const p = pointAt(g, s, side * offset);
      walked += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      if (walked < spacing) continue;
      walked -= spacing;
      if (p.x < 0 || p.y < 0 || p.x >= g.width || p.y >= g.height) continue;
      const deck = deckOf(g, Math.floor(s / g.ds));
      if (deck) {
        const lx = Math.floor(p.x) - deck.x0;
        const ly = Math.floor(p.y) - deck.y0;
        const k = deck.seg[ly * deck.w + lx];
        if (k < 0 || Math.abs(Math.sqrt(deck.dist2[ly * deck.w + lx]) - offset) > 2.5 || Math.abs(wrapS(g, k * g.ds - s)) > 40) continue;
      } else {
        const pr = probe(g, p.x, p.y);
        if (Math.abs(pr.dist - offset) > 2.5 || Math.abs(wrapS(g, pr.s - s)) > 40) continue;
      }
      out.push({ x: p.x, y: p.y, angle: p.angle, s, side, z: heightAt(g, s), deck: !!deck });
    }
  }
  return out;
}

/** A stack of three tyres (an octagonal tube), in white so each stack can be tinted black, red or white. */
export function tyreStack(): VoxelGrid {
  const g = new VoxelGrid(6, 6, 6);
  const rubber = hex('#e8e8ee');
  const seam = hex('#a4a8b8');
  const hole = hex('#14151f');
  for (let y = 0; y < 6; y++) {
    for (let z = 0; z < 6; z++) {
      for (let x = 0; x < 6; x++) {
        const corner = (x === 0 || x === 5) && (z === 0 || z === 5);
        if (corner) continue;
        const inner = x >= 2 && x <= 3 && z >= 2 && z <= 3;
        g.set(x, y, z, inner ? hole : y === 1 || y === 3 ? seam : rubber);
      }
    }
  }
  return g;
}

/** A chunky boulder for the canyon walls (drawn at half resolution: place it at scale 2). */
export function boulder(seed: number): VoxelGrid {
  const R = rng(seed);
  const g = new VoxelGrid(5, 4, 5);
  const light = hex('#d98b4e');
  const mid = hex('#b86b40');
  const dark = hex('#8f4f32');
  const rx = 2.1 + R() * 0.5;
  const ry = 2.6 + R() * 1.2;
  const rz = 2.0 + R() * 0.5;
  for (let z = 0; z < 5; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        const dx = (x + 0.5 - 2.5) / rx;
        const dy = (y + 0.5) / ry;
        const dz = (z + 0.5 - 2.5) / rz;
        if (dx * dx + dy * dy + dz * dz + (hash2(x, y * 7 + z, seed) - 0.5) * 0.3 > 1) continue;
        g.set(x, y, z, y === 3 || dy > 0.75 ? light : x + z < 4 ? mid : dark);
      }
    }
  }
  return g;
}

/** One 6 px stretch of concrete barrier (the neon strip on top is separate, so it can glow). */
export function concreteBlock(): { block: VoxelGrid; neon: VoxelGrid } {
  const block = new VoxelGrid(6, 6, 6);
  const top = hex('#b8bed4');
  const side = hex('#8f95ad');
  const joint = hex('#5b6080');
  for (let z = 0; z < 6; z++) {
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        // Jersey-barrier profile: wide foot, narrower top
        if (y >= 2 && (z === 0 || z === 5)) continue;
        block.set(x, y, z, x === 0 ? joint : y === 4 ? top : side);
      }
    }
  }
  const neon = new VoxelGrid(6, 6, 6);
  neon.box(0, 5, 1, 6, 6, 5, hex('#ffffff'));
  return { block, neon };
}

/** One 6 px stretch of a stone bridge's parapet: dressed blocks with darker joints. */
export function stoneParapet(): VoxelGrid {
  const g = new VoxelGrid(6, 6, 6);
  const stone = hex('#c2c8d6');
  const shadow = hex('#94b0c2');
  const joint = hex('#566c86');
  for (let z = 1; z < 5; z++) {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const course = y < 3 ? 0 : 1;
        const seam = x === (course ? 2 : 5) || y === 2;
        g.set(x, y, z, seam ? joint : y === 5 ? stone : (x + y) % 5 === 0 ? shadow : stone);
      }
    }
  }
  return g;
}

/** One 6 px stretch of a timber trestle's railing: a post and two rails. */
export function timberRail(): VoxelGrid {
  const g = new VoxelGrid(6, 7, 6);
  const wood = hex('#b97a4a');
  const dark = hex('#8f5a36');
  const end = hex('#5d3b24');
  g.box(0, 0, 2, 2, 7, 4, dark);
  g.set(0, 6, 2, end);
  g.set(1, 6, 3, end);
  g.box(0, 5, 2, 6, 6, 4, wood);
  g.box(0, 2, 2, 6, 3, 4, wood);
  return g;
}

// ---------------------------------------------------------------------------
// Buildings: boxes with painted faces
// ---------------------------------------------------------------------------

export interface BuildingFaces {
  /** Footprint (world px) and height. */
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  /** Seen from outside: roof (w x d), then walls facing north, south (w wide), west, east (d wide); all h tall. */
  faces: Raster[];
  /** Same sizes: only the lit windows and signs, for night glow. */
  glow: Raster[];
}

const LIT = ['#ffe9a8', '#ffcd75', '#73eff7', '#ff79c6'].map(hex);
const NEON = ['#ff4fd8', '#41e6ff', '#a7f070'].map(hex);

function facade(len: number, h: number, wall: number, dark: number, outline: number, R: () => number, sign: boolean): [Raster, Raster] {
  const c = new Raster(len, h).fill(wall);
  const glow = new Raster(len, h).fill(hex('#000000'));
  c.fillRect(0, 0, len, 2, dark);
  c.fillRect(0, 0, len, 1, outline);
  c.fillRect(0, h - 2, len, 2, shade(wall, -0.3));
  for (let y = 0; y < h; y++) {
    c.set(0, y, outline);
    c.set(len - 1, y, outline);
  }
  const unlit = shade(wall, -0.45);
  for (let y = 5; y + 3 <= h - 3; y += 5) {
    for (let x = 3; x + 3 <= len - 2; x += 5) {
      if (R() < 0.5) {
        const lc = LIT[Math.floor(R() * LIT.length)];
        c.fillRect(x, y, 3, 3, lc);
        glow.fillRect(x, y, 3, 3, lc);
      } else c.fillRect(x, y, 3, 3, unlit);
    }
  }
  if (sign && len > 30 && h > 16) {
    const sw = Math.min(len - 10, 14 + Math.floor(R() * 12));
    const sx = Math.floor((len - sw) / 2);
    const col = NEON[Math.floor(R() * NEON.length)];
    c.fillRect(sx - 1, 3, sw + 2, 6, shade(col, -0.55));
    c.fillRect(sx, 4, sw, 4, col);
    glow.fillRect(sx, 4, sw, 4, col);
  }
  return [c, glow];
}

/** A building's box and painted faces, from its overhead drawing (roof on top, front wall below). */
export function buildingFaces(b: Block, index: number): BuildingFaces {
  const art = b.art;
  const w = art.w;
  const d = b.topRows;
  const front = art.h - b.topRows;
  const h = Math.round(front * 1.7) + 6;
  const R = rng(index * 977 + 13);
  const px = (x: number, y: number) => art.px[y * art.w + x];
  const outline = px(0, 0);
  const dark = px(1, b.topRows);
  const wall = px(1, b.topRows + 1);
  // the drawing's front wall faces south; it keeps its sign if it had one
  const hadSign = (() => {
    for (let y = b.topRows + 1; y < b.topRows + 6 && y < art.h; y++)
      for (let x = 0; x < w; x++) if (NEON.includes(px(x, y))) return true;
    return false;
  })();
  const roof = new Raster(w, d);
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) roof.px[y * w + x] = px(x, y);
  const north = facade(w, h, wall, dark, outline, R, false);
  const south = facade(w, h, wall, dark, outline, R, hadSign);
  const west = facade(d, h, wall, dark, outline, R, false);
  const east = facade(d, h, wall, dark, outline, R, false);
  return {
    x: b.x,
    y: b.y,
    w,
    d,
    h,
    faces: [roof, north[0], south[0], west[0], east[0]],
    glow: [new Raster(w, d).fill(hex('#000000')), north[1], south[1], west[1], east[1]],
  };
}

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Packs rasters into one texture (shelf packing, 2 px gutters with the
 * edges repeated, so filtering never bleeds between neighbours).
 */
export function packAtlas(sizes: { w: number; h: number }[], width = 2048): { w: number; h: number; rects: AtlasRect[] } {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h);
  const rects: AtlasRect[] = new Array(sizes.length);
  let x = 0;
  let y = 0;
  let shelf = 0;
  const pad = 2;
  for (const i of order) {
    const s = sizes[i];
    if (x + s.w + pad * 2 > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    rects[i] = { x: x + pad, y: y + pad, w: s.w, h: s.h };
    x += s.w + pad * 2;
    shelf = Math.max(shelf, s.h + pad * 2);
  }
  return { w: width, h: y + shelf, rects };
}

/** Copies a raster into an atlas at `r`, repeating its edge pixels into the gutter. */
export function blitPadded(atlas: Raster, src: Raster, r: AtlasRect, pad = 2): void {
  for (let y = -pad; y < src.h + pad; y++) {
    const sy = Math.min(src.h - 1, Math.max(0, y));
    for (let x = -pad; x < src.w + pad; x++) {
      const sx = Math.min(src.w - 1, Math.max(0, x));
      atlas.set(r.x + x, r.y + y, src.px[sy * src.w + sx]);
    }
  }
}

// ---------------------------------------------------------------------------
// Mesas and grandstands: voxels
// ---------------------------------------------------------------------------

/** A mesa from its overhead drawing: the plateau's outline, raised on striped cliffs over a rubble foot. */
export function mesaVoxels(b: Block): { grid: VoxelGrid; x: number; y: number } {
  const art = b.art;
  const w = art.w;
  const d = b.topRows;
  const H = Math.round((art.h - b.topRows) * 2.4);
  const foot = 3;
  const g = new VoxelGrid(w + foot * 2, H, d + foot * 2);
  const cliff = hex('#d0814f');
  const cliffDark = hex('#ad6440');
  const line = hex('#8a4a32');
  const rubble = hex('#c99a55');
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < w && z < d && art.px[z * w + x] >>> 24 !== 0;
  const seed = b.x * 31 + b.y;
  for (let z = -foot; z < d + foot; z++) {
    for (let x = -foot; x < w + foot; x++) {
      if (inside(x, z)) {
        for (let y = 0; y < H; y++) {
          let c: number;
          if (y === H - 1) c = art.px[z * w + x];
          else {
            const band = Math.floor((H - 1 - y + hash2(x, z, seed) * 2) / 3);
            c = y < 2 ? line : band % 3 === 2 ? cliffDark : band % 2 ? mix(cliff, cliffDark, 0.4) : cliff;
          }
          g.set(x + foot, y, z + foot, c);
        }
        continue;
      }
      // rubble slope round the foot of the cliffs
      let near = Infinity;
      for (let dz = -foot; dz <= foot; dz++) for (let dx = -foot; dx <= foot; dx++) if (inside(x + dx, z + dz)) near = Math.min(near, Math.hypot(dx, dz));
      const hgt = Math.round(foot + 1 - near - hash2(x, z, seed + 1) * 1.2);
      for (let y = 0; y < hgt; y++) g.set(x + foot, y, z + foot, y === hgt - 1 ? rubble : cliff);
    }
  }
  return { grid: g, x: b.x - foot, y: b.y - foot };
}

/**
 * A grandstand from its overhead drawing: tiers rising away from the track
 * with the crowd standing on them, and the striped roof on top.
 * `facesNorth` turns it round when the track is on its north side.
 */
export function standVoxels(b: Block, facesNorth: boolean): VoxelGrid {
  const art = b.art;
  const w = art.w;
  const d = art.h;
  const g = new VoxelGrid(w, 27, d);
  const px = (x: number, y: number) => art.px[y * w + x];
  // tier rows 2 and 3 of every 4 are plain seats in the drawing
  const seat = px(5, 12);
  const seatShadow = px(5, 13);
  const seatDark = shade(seat, -0.35);
  const back = shade(seat, -0.5);
  const rail = hex('#c2c8d6');
  const roofA = px(7, 2);
  const roofB = px(1, 2);
  const R = rng(b.x * 7 + b.y);
  // rows front (track side) to back, as drawn: rows 10..30 are the tiers
  const tierTop = (row: number) => 4 + (5 - Math.min(5, Math.floor((row - 10) / 4))) * 3;
  for (let row = 0; row < d; row++) {
    const z = facesNorth ? d - 1 - row : row;
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || x === w - 1;
      if (row < 3) {
        g.box(x, 0, z, x + 1, 24, z + 1, back);
      } else if (row < 10) {
        g.box(x, 0, z, x + 1, 19, z + 1, edge ? back : seatDark);
        g.set(x, 18, z, edge ? back : seat);
      } else if (row < d - 3) {
        const top = tierTop(row);
        g.box(x, 0, z, x + 1, top, z + 1, edge ? back : seatDark);
        const c = px(x, row);
        const crowd = c !== seat && c !== seatShadow;
        g.set(x, top - 1, z, edge ? back : crowd ? seat : c);
        // people: the drawing's crowd pixels stand up off the seats
        if (!edge && crowd && R() < 0.85) {
          g.set(x, top, z, c);
          if (R() < 0.6) g.set(x, top + 1, z, hex('#f4c69a'));
        }
      } else {
        g.box(x, 0, z, x + 1, 3, z + 1, rail);
      }
    }
  }
  // the roof: a striped canopy over the back half, on posts at its front edge
  for (let row = 0; row < 17; row++) {
    const z = facesNorth ? d - 1 - row : row;
    for (let x = 0; x < w; x++) g.set(x, 25, z, Math.floor(x / 6) & 1 ? roofA : roofB);
  }
  const postRow = facesNorth ? d - 17 : 16;
  for (let x = 2; x < w; x += 20) for (let y = tierTop(16); y < 25; y++) g.set(x, y, postRow, back);
  return g;
}

/** Does the track pass north of this block (so a grandstand should face north)? */
export function trackIsNorth(g: TrackGeometry, b: Block): boolean {
  const cx = b.x + b.art.w / 2;
  const cy = b.y + b.art.h / 2;
  const pr = probe(g, cx, cy);
  const p = pointAt(g, pr.s);
  return p.y < cy;
}

/**
 * An arch over the start line, `span` px wide. Local axes: x along the road
 * (it is 4 px thick), z across it, y up. Night tracks get a neon strip.
 */
export function startGantry(span: number, theme: 'meadow' | 'canyon' | 'city'): { grid: VoxelGrid; glow: VoxelGrid | null } {
  const H = 32;
  const T = 4;
  const g = new VoxelGrid(T, H, span);
  const pillar = hex(theme === 'canyon' ? '#a0683f' : theme === 'city' ? '#3a3f5c' : '#f4f4f4');
  const stripe = hex(theme === 'canyon' ? '#6b412a' : theme === 'city' ? '#29366f' : '#e43b44');
  const white = hex('#f4f4f4');
  const black = hex('#1a1c2c');
  for (const z0 of [0, span - T]) {
    for (let z = z0; z < z0 + T; z++) for (let y = 0; y < H - 8; y++) for (let x = 0; x < T; x++) g.set(x, y, z, Math.floor(y / 4) % 2 ? stripe : pillar);
  }
  // the chequered banner
  for (let z = 0; z < span; z++) {
    for (let y = H - 8; y < H; y++) {
      for (let x = 0; x < T; x++) g.set(x, y, z, y === H - 1 || y === H - 8 ? stripe : (Math.floor(z / 3) + Math.floor(y / 3)) % 2 ? black : white);
    }
  }
  if (theme !== 'city') return { grid: g, glow: null };
  const glow = new VoxelGrid(T, H, span);
  for (let z = T; z < span - T; z++) glow.set(0, H - 9, z, hex(Math.floor(z / 12) % 2 ? '#ff4fd8' : '#41e6ff'));
  for (let z = T; z < span - T; z++) glow.set(T - 1, H - 9, z, hex(Math.floor(z / 12) % 2 ? '#ff4fd8' : '#41e6ff'));
  return { grid: g, glow };
}
