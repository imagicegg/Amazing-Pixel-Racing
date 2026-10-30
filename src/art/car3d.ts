// Turns a car's top-view pixel art into a chunky voxel model for the 3D chase
// view, so every car, including the ones painted in the paint shop, gets a
// 3D body without anyone modelling it. Pure code, no three.js.
//
// The drawing gives the footprint and the colours seen from above. Heights
// come from what the letters mean: the rows with the eyes (the windshield)
// start a tall cabin, the bonnet in front of it is low, and the rear deck
// behind it is in between. Sides get body colour with a band of side
// windows, the cabin's front shows the eyes, and the tyres become separate
// wheels that can spin and steer.
import { hex, shade } from './raster.ts';
import { carPalette, closeEyes, shiftPupils } from './sprites.ts';
import type { CarDesign } from './cars.ts';
import { VoxelGrid } from './voxel.ts';

/** Heights in voxels (1 voxel = 1 world pixel). */
const CLEAR = 2; // ground clearance under the body
const HOOD = 7; // bonnet
const CABIN = 11; // roof
const DECK = 8; // rear deck

const TYRE = new Set(['t', 'T']);
const EYE = new Set(['W', 'w', 'i', 'p']);
/** Colours that belong on top only (stripes, decals, eyes): sides use the body colour instead. */
const TOP_ONLY = new Set(['a', 'A', 'n', 'W', 'w', 'i', 'p', 'h', 'g', 'G', 'k']);

export interface WheelSpec {
  /** Centre, in sprite pixels (x across, y along; the nose is at y = 0). */
  x: number;
  y: number;
  /** Tyre width (along the axle) and diameter, in voxels. */
  width: number;
  diameter: number;
  front: boolean;
  /** On the car's left side (its hubcap faces -x). */
  left: boolean;
}

export interface CarShape {
  /** Sprite size in pixels. */
  cols: number;
  rows: number;
  wheels: WheelSpec[];
  /** Which pixels are body (row-major), and how tall each column stands. */
  body: Uint8Array;
  top: Uint8Array;
  cabinStart: number;
  cabinEnd: number;
  /** Columns of the main body (measured across the windshield). */
  bodyL: number;
  bodyR: number;
  /** Rows of a rear wing, if the car has one (drawn with 's' at the back). */
  wing: [number, number] | null;
}

function grid(rows: readonly string[]): { w: number; h: number; at: (x: number, y: number) => string } {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  return { w, h, at: (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? rows[y][x] ?? '.' : '.') };
}

/** Works out the 3D shape (not the colours) from a car's top-view drawing. */
export function carShape(top: readonly string[]): CarShape {
  const { w, h, at } = grid(top);

  // wheels: each connected patch of tyre pixels
  const wheels: WheelSpec[] = [];
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !TYRE.has(at(x, y))) continue;
      let x0 = x;
      let x1 = x;
      let y0 = y;
      let y1 = y;
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        x0 = Math.min(x0, cx);
        x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy);
        y1 = Math.max(y1, cy);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (!TYRE.has(at(nx, ny)) || seen[ny * w + nx]) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      const cx = (x0 + x1 + 1) / 2;
      // a touch bigger than drawn: chibi cars have big wheels
      wheels.push({ x: cx, y: (y0 + y1 + 1) / 2, width: x1 - x0 + 2, diameter: Math.max(6, y1 - y0 + 2), front: (y0 + y1) / 2 < h / 2, left: cx < w / 2 });
    }
  }

  // the body's width, measured across the windshield (or the commonest row)
  const eyeRows: number[] = [];
  for (let y = 0; y < h; y++) if ([...top[y]].some((c) => EYE.has(c))) eyeRows.push(y);
  const extent = (y: number): [number, number] => {
    let a = w;
    let b = -1;
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      if (c === '.' || TYRE.has(c)) continue;
      a = Math.min(a, x);
      b = Math.max(b, x);
    }
    return [a, b];
  };
  let bodyL = w;
  let bodyR = -1;
  for (const y of eyeRows.length ? eyeRows : Array.from({ length: h }, (_, i) => i)) {
    const [a, b] = extent(y);
    if (b < 0) continue;
    if (eyeRows.length) {
      bodyL = Math.min(bodyL, a);
      bodyR = Math.max(bodyR, b);
    } else if (b - a > bodyR - bodyL) {
      bodyL = a;
      bodyR = b;
    }
  }
  const nearTyre = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (TYRE.has(at(x + dx, y + dy))) return true;
    return false;
  };
  const body = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      if (c === '.' || TYRE.has(c)) continue;
      // outline drawn round a tyre that pokes out sideways belongs to the wheel
      if ((x < bodyL || x > bodyR) && c === 'k' && nearTyre(x, y)) continue;
      body[y * w + x] = 1;
    }
  }

  const first = eyeRows.length ? eyeRows[0] : Math.round(h * 0.3);
  const last = eyeRows.length ? eyeRows[eyeRows.length - 1] : Math.round(h * 0.45);
  const cabinStart = Math.max(1, first - 1);
  const cabinEnd = Math.min(h - 4, last + Math.max(3, Math.round(h * 0.3)));

  // a rear wing: dark trim ('s') drawn across the last quarter
  const sRows: number[] = [];
  for (let y = Math.floor(h * 0.75); y < h; y++) if (top[y].includes('s')) sRows.push(y);
  let wing: [number, number] | null = null;
  if (sRows.length) {
    const mostlyOutline = (y: number) => {
      const cells = [...(top[y] ?? '')].filter((c) => c !== '.');
      return cells.length > 0 && cells.filter((c) => c === 'k').length >= cells.length * 0.7;
    };
    let a = sRows[0];
    let b = sRows[sRows.length - 1];
    if (a > 0 && mostlyOutline(a - 1)) a--;
    if (b < h - 1 && mostlyOutline(b + 1)) b++;
    wing = [a, b];
  }

  const topH = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!body[y * w + x]) continue;
      // the cabin's first and last rows step down, so its roof looks rounded
      let t = y < cabinStart ? HOOD : y === cabinStart || y === cabinEnd ? CABIN - 1 : y < cabinEnd ? CABIN : DECK;
      // the wing floats; under it is just the end of the deck
      if (wing && y >= wing[0] && y <= wing[1]) t = x >= bodyL && x <= bodyR ? DECK : 0;
      // soften the silhouette: lower the outermost ring by one
      const edge = x === 0 || x === w - 1 || y === 0 || y === h - 1 || !body[y * w + x - 1] || !body[y * w + x + 1] || !body[(y - 1) * w + x] || !body[(y + 1) * w + x];
      if (t && edge) t -= 1;
      topH[y * w + x] = t;
    }
  }
  return { cols: w, rows: h, wheels, body, top: topH, cabinStart, cabinEnd, bodyL, bodyR, wing };
}

/**
 * One voxel body. `look` slides the pupils like the sprite sheet rows (0 ahead,
 * 1 left, 2 right); `blink` closes the eyes. Axes: x = sprite column, y = up,
 * z = sprite row (the nose is at z = 0).
 */
export function carVoxels(design: CarDesign, alt: boolean, look: number, blink: boolean, shape = carShape(design.top)): VoxelGrid {
  const pal = carPalette(design, alt);
  const colour = (ch: string) => (pal[ch] ? hex(pal[ch]) : hex('#ff00ff'));
  let rows = shiftPupils(design.top, [0, -1, 1][look] ?? 0);
  if (blink) rows = closeEyes(rows);
  const { w, h, at } = grid(rows);
  const { body, top, cabinStart, cabinEnd, bodyL, bodyR, wing } = shape;
  const B = colour('B');
  const sideBody = B;
  const trim = shade(colour('b'), -0.35);
  const glass = colour('g');
  const glassShine = colour('G');
  const outline = colour('k');

  // the eyes as seen from the front: the eye row with the most pupils
  let eyeRow = -1;
  let best = 0;
  for (let y = 0; y < h; y++) {
    const n = [...rows[y]].filter((c) => c === 'p').length;
    if (n > best) {
      best = n;
      eyeRow = y;
    }
  }
  if (eyeRow < 0) for (let y = 0; y < h && eyeRow < 0; y++) if ([...rows[y]].some((c) => EYE.has(c) || c === 'B')) eyeRow = y;

  const inBody = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && body[y * w + x] === 1;
  const height = (x: number, y: number) => (inBody(x, y) ? top[y * w + x] : 0);
  /** Body colour seen on a side: the first colour in from the edge that isn't outline or top-only. */
  const sideColour = (x: number, y: number) => {
    const dir = x < w / 2 ? 1 : -1;
    for (let i = x; i >= 0 && i < w; i += dir) {
      const c = at(i, y);
      if (c === 'y' || c === 'R') return colour(c);
      if (c !== '.' && !TOP_ONLY.has(c) && !TYRE.has(c)) return colour(c);
    }
    return sideBody;
  };
  const headlight = (x: number) => {
    for (let y = 0; y < Math.min(h, 6); y++) if (at(x, y) === 'y' || at(x, y) === 'Y') return true;
    return false;
  };
  // tail lights drawn outside the body (on a wing, say) move in to its edge
  const tails = new Set<number>();
  for (let y = Math.max(0, h - 7); y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 'R') continue;
      tails.add(Math.min(Math.max(x, bodyL + 1), bodyR - 1));
    }
  }
  const taillight = (x: number) => tails.has(x);
  const mid = (w - 1) / 2;

  const g = new VoxelGrid(w, CABIN + 2, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBody(x, y)) continue;
      const t = top[y * w + x];
      const inCabin = y >= cabinStart && y <= cabinEnd;
      for (let v = CLEAR; v < t; v++) {
        let c: number;
        const front = v >= height(x, y - 1);
        const back = v >= height(x, y + 1);
        const side = v >= height(x - 1, y) || v >= height(x + 1, y);
        const underWing = wing !== null && y >= wing[0] && y <= wing[1];
        if (v === t - 1) c = underWing ? colour('b') : colour(at(x, y));
        else if (v === CLEAR) c = trim;
        else if (front && inCabin && v >= HOOD) {
          // the windshield seen from the front: the eyes again
          // (white above, pupil below it, so they read as eyes looking at you)
          const e = at(x, eyeRow);
          c = v === HOOD ? outline : e === 'p' && v === HOOD + 1 ? colour('p') : EYE.has(e) ? colour('W') : e === 'k' || e === '.' ? outline : colour(e);
        } else if (front && !inCabin) {
          if (headlight(x) && v >= HOOD - 3 && v <= HOOD - 2) c = colour('y');
          else if (Math.abs(x - mid) <= 2 && v === CLEAR + 1) c = colour('m');
          else if (Math.abs(x - mid) <= 2 && v === CLEAR + 2) c = colour('q');
          else c = B;
        } else if (back && inCabin && v >= DECK - 1) {
          c = v === t - 2 ? glassShine : glass;
        } else if (back) {
          c = taillight(x) && v >= DECK - 3 && v <= DECK - 2 ? colour('R') : colour('b');
        } else if (side && inCabin && v >= HOOD) {
          // side windows, with the pillars at either end in body colour
          c = y === cabinStart || y === cabinEnd ? sideColour(x, y) : v === t - 2 ? glassShine : glass;
        } else c = sideColour(x, y);
        g.set(x, v, y, c);
      }
    }
  }

  if (wing) {
    // a floating wing on two posts
    const [a, b] = wing;
    for (let y = a; y <= b; y++) {
      for (let x = 0; x < w; x++) {
        const ch = at(x, y);
        if (ch === '.' || TYRE.has(ch)) continue;
        g.set(x, DECK + 2, y, colour(ch));
      }
    }
    const postY = Math.round((a + b) / 2);
    for (const x of [Math.round(w * 0.25), Math.round(w * 0.75) - 1]) for (let v = DECK; v < DECK + 2; v++) g.set(x, v, postY, colour('s'));
  }
  return g;
}

/** A tyre seen side-on is a disc; the tread alternates so you can see it roll. */
export function wheelVoxels(design: CarDesign, alt: boolean, wheel: WheelSpec): VoxelGrid {
  const pal = carPalette(design, alt);
  const tyre = hex(pal.t);
  const tread = hex(pal.T);
  const hub = hex(pal.z);
  const d = wheel.diameter;
  const r = d / 2;
  const g = new VoxelGrid(wheel.width, d, d);
  for (let z = 0; z < d; z++) {
    for (let y = 0; y < d; y++) {
      const dy = y + 0.5 - r;
      const dz = z + 0.5 - r;
      const dist = Math.hypot(dy, dz);
      if (dist > r) continue;
      const rim = dist > r - 1.3;
      const sector = Math.floor(((Math.atan2(dz, dy) + Math.PI) / (Math.PI * 2)) * 8) % 2;
      for (let x = 0; x < wheel.width; x++) {
        const outer = wheel.left ? x === 0 : x === wheel.width - 1;
        g.set(x, y, z, rim ? (sector ? tread : tyre) : outer && dist < r * 0.55 ? hub : tyre);
      }
    }
  }
  return g;
}
