// Turns the ASCII designs into finished rasters: rotated car sheets,
// blinking portraits and the small UI icons. Pure code, no Phaser.
import { Raster, fromMap, rotSprite, scale2x, type Palette } from './raster.ts';
import { BASE_PALETTE, type CarDesign } from './cars.ts';

/** Number of pre-rotated directions per car (11.25 degrees apart). */
export const CAR_DIRECTIONS = 32;
/** Rows of the car sheet: eyes looking ahead, left, right. */
export const LOOK_AHEAD = 0;
export const LOOK_LEFT = 1;
export const LOOK_RIGHT = 2;

export function carPalette(design: CarDesign, alt = false): Palette {
  return { ...BASE_PALETTE, ...design.palette, ...(alt ? design.alt.palette : {}) };
}

/** Moves every pupil pixel sideways by dx, as long as it stays inside the eye white. */
export function shiftPupils(rows: readonly string[], dx: number): string[] {
  const grid = rows.map((r) => r.split(''));
  if (!dx) return grid.map((r) => r.join(''));
  const pupils: [number, number][] = [];
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c === 'p') {
        pupils.push([x, y]);
        row[x] = 'W';
      }
    }),
  );
  for (const [x, y] of pupils) {
    const t = rows[y][x + dx];
    if (t === 'W' || t === 'p') grid[y][x + dx] = 'p';
    else grid[y][x] = 'p';
  }
  return grid.map((r) => r.join(''));
}

const EYE = new Set(['W', 'w', 'i', 'p']);

/** Replaces every eye (a connected patch of W/w/i/p) by a closed, smiling lid. */
export function closeEyes(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => r.padEnd(w, '.').split(''));
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !EYE.has(grid[y][x])) continue;
      const stack = [[x, y]];
      const cells: [number, number][] = [];
      seen[y * w + x] = 1;
      let x0 = x, x1 = x, y0 = y, y1 = y;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]);
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !EYE.has(grid[ny][nx])) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (cells.length < 4) continue;
      for (const [cx, cy] of cells) grid[cy][cx] = 'B';
      const yc = Math.round(y0 + (y1 - y0) * 0.6);
      for (let i = x0 + 1; i <= x1 - 1; i++) grid[yc][i] = 'k';
      grid[yc - 1][x0] = 'k';
      grid[yc - 1][x1] = 'k';
    }
  }
  return grid.map((r) => r.join(''));
}

export interface CarSheet {
  /** Square frame size of one rotation. */
  frame: number;
  /** CAR_DIRECTIONS columns x 3 rows (ahead / left / right). */
  raster: Raster;
  /** The unrotated top view (nose up), for UI. */
  plain: Raster;
}

function evenPad(r: Raster): Raster {
  if (r.w % 2 === 0 && r.h % 2 === 0) return r;
  const out = new Raster(r.w + (r.w % 2), r.h + (r.h % 2));
  return out.blit(r, 0, 0);
}

export function buildCarSheet(design: CarDesign, alt = false): CarSheet {
  const pal = carPalette(design, alt);
  const looks = [0, -1, 1].map((dx) => evenPad(fromMap(shiftPupils(design.top, dx), pal)));
  const { w, h } = looks[0];
  let frame = Math.ceil(Math.hypot(w, h)) + 2;
  frame += frame % 2;
  const raster = new Raster(frame * CAR_DIRECTIONS, frame * looks.length);
  looks.forEach((src, row) => {
    const big = scale2x(scale2x(scale2x(src)));
    for (let d = 0; d < CAR_DIRECTIONS; d++) {
      const rot = rotSprite(src, (d * Math.PI * 2) / CAR_DIRECTIONS, frame, frame, big);
      raster.blit(rot, d * frame, row * frame);
    }
  });
  return { frame, raster, plain: looks[0] };
}

/** Sheet column for a heading in radians (0 = facing +x / east). */
export function directionFrame(angle: number): number {
  const turn = angle + Math.PI / 2; // sprites are drawn facing up
  const step = (Math.PI * 2) / CAR_DIRECTIONS;
  return ((Math.round(turn / step) % CAR_DIRECTIONS) + CAR_DIRECTIONS) % CAR_DIRECTIONS;
}

/** Headlight cone pointing right (+x), dithered, brightest at its left middle (its origin). */
export function coneRaster(): Raster {
  const white = 0xffffffff;
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const cone = new Raster(48, 30);
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 48; x++) {
      const u = x / 48;
      const v = Math.abs(y + 0.5 - 15) / 15;
      if (v > u * 1.05 + 0.08) continue;
      const a = (1 - u) * (1 - v * 0.7);
      if (a * 16 > bayer[(y & 3) * 4 + (x & 3)] + 3) cone.set(x, y, white);
    }
  }
  return cone;
}

export interface Portrait {
  open: Raster;
  blink: Raster;
}

export function buildPortrait(design: CarDesign, alt = false): Portrait {
  const pal = carPalette(design, alt);
  return { open: fromMap(design.front, pal), blink: fromMap(closeEyes(design.front), pal) };
}

// ---------------------------------------------------------------------------
// Small UI icons
// ---------------------------------------------------------------------------

const UI_PAL: Palette = {
  k: '#1a1c2c',
  W: '#f4f4f4',
  w: '#94b0c2',
  y: '#ffcd75',
  Y: '#fff3a0',
  o: '#ef7d57',
  r: '#b13e53',
  R: '#e43b44',
  g: '#38b764',
  G: '#a7f070',
  d: '#566c86',
  D: '#333c57',
  b: '#3b5dc9',
  c: '#73eff7',
};

const ICONS: Record<string, string[]> = {
  star: ['...k...', '..kyk..', 'kkkyYkk', 'kyyyyyk', '.kyyyk.', 'kyykyyk', 'kk...kk'],
  starEmpty: ['...k...', '..kDk..', 'kkkDDkk', 'kDDDDDk', '.kDDDk.', 'kDDkDDk', 'kk...kk'],
  arrowRight: ['kk....', 'kWk...', 'kWWk..', 'kWWWk.', 'kWWk..', 'kWk...', 'kk....'],
  pip: ['kkkkkk', 'kyYYyk', 'kyyyyk', 'kooook', 'kkkkkk'],
  pipEmpty: ['kkkkkk', 'kDDDDk', 'kDDDDk', 'kDDDDk', 'kkkkkk'],
  flag: [
    'kkkkkkkkkkkk',
    'kWkkWWkkWWk.',
    'kkWWkkWWkkWk',
    'kWkkWWkkWWk.',
    'kkWWkkWWkkWk',
    'kkkkkkkkkkk.',
    'kd..........',
    'kd..........',
    'kd..........',
    'kd..........',
  ],
  crown: [
    '.k...k...k.',
    'kyk.kyk.kyk',
    'kyykyyykyyk',
    'kyyyyyyyyyk',
    'kyRyyYyyRyk',
    'kkkkkkkkkkk',
  ],
  lightOff: ['.kkkk.', 'kDDDDk', 'kDddDk', 'kDDDDk', 'kDDDDk', '.kkkk.'],
  lightRed: ['.kkkk.', 'krRRrk', 'kRWRRk', 'kRRRRk', 'krRRrk', '.kkkk.'],
  lightGreen: ['.kkkk.', 'kgGGgk', 'kGWGGk', 'kGGGGk', 'kgGGgk', '.kkkk.'],
  heart: ['.kk.kk.', 'kRRkRRk', 'kRWRRRk', 'kRRRRRk', '.kRRRk.', '..kRk..', '...k...'],
  palette: [
    '....kkkkkkk.....',
    '..kkYYYYYYYkk...',
    '.kYYRRYYYYooYk..',
    'kYYRRRYYYooooYk.',
    'kYYYRYYYYYooYYk.',
    'kYYYYYYkkYYYYYYk',
    'kYbbYYk..kYYccYk',
    'kYbbbYk..kYcccYk',
    'kYYbYYYkkYYYcYYk',
    '.kYYYYYYYYGGYYk.',
    '..kkyYYYYGGGyk..',
    '....kkkkkkkkk...',
  ],
  speaker: ['...kk..', '..kWk.k', 'kkWWk..', 'kWWWk.k', 'kkWWk..', '..kWk.k', '...kk..'],
  speakerOff: ['...kk..', '..kWk..', 'kkWWkkk', 'kWWWk.k', 'kkWWkkk', '..kWk..', '...kk..'],
};

export function buildIcons(): Map<string, Raster> {
  const out = new Map<string, Raster>();
  for (const [name, rows] of Object.entries(ICONS)) out.set(name, fromMap(rows, UI_PAL));
  return out;
}
