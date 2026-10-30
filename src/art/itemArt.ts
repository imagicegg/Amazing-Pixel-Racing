// Pictures of the race items (see game/items.ts): spinning gold coins, the
// rocket and bubble pickups, missiles in flight, the shield round a car,
// dizzy stars, and the things to knock over (hay bales, kegs, traffic cones).
// Pixel sprites for the overhead view, the HUD and the software chase view,
// and voxel models for the 3D chase view. Pure code.
import { Raster, fromMap, hex, rotSprite, scale2x, type Palette } from './raster.ts';
import { VoxelGrid } from './voxel.ts';
import type { ObstacleKind } from '../tracks/themes.ts';

const GOLD = { outline: hex('#6b412a'), shine: hex('#fff3a0'), gold: hex('#ffcd75'), deep: hex('#e8a14a'), shadow: hex('#c27a3a') };

/**
 * A coin turning about its upright axis, as four frames: face on, three
 * quarters, edge on, three quarters from the other side.
 */
export function coinFrames(): Raster[] {
  return [
    [7, false],
    [5, false],
    [2, false],
    [5, true],
  ].map(([w, flip]) => coinFrame(w as number, flip as boolean));
}

function coinFrame(w: number, flip: boolean): Raster {
  const inner = new Raster(7, 8);
  const cx = 3.5;
  const cy = 4;
  const rx = Math.max(1, w / 2);
  for (let y = 0; y < inner.h; y++) {
    for (let x = 0; x < inner.w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / 4;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      // lit from the upper left; a stamped ring on the face; the edge view is all rim
      const side = flip ? -dx : dx;
      let c = side + dy < -0.55 ? GOLD.shine : side + dy > 0.75 ? GOLD.shadow : GOLD.gold;
      if (w > 4 && d > 0.3 && d < 0.5) c = GOLD.deep;
      if (w <= 2) c = dy < -0.4 ? GOLD.shine : GOLD.deep;
      inner.set(x, y, c);
    }
  }
  return inner.outlined(GOLD.outline);
}

const ITEM_PAL: Palette = {
  k: '#1a1c2c',
  R: '#e43b44',
  r: '#b13e53',
  W: '#f4f4f4',
  w: '#94b0c2',
  b: '#41a6f6',
  o: '#ef7d57',
  y: '#ffcd75',
  c: '#73eff7',
  s: '#41a6f6',
  n: '#29366f',
};

/** The rocket, nose up: the missile pickup, the HUD icon and (rotated) the missile in flight. */
export function rocketIcon(): Raster {
  return fromMap(
    [
      '...k...',
      '..kRk..',
      '.kRRRk.',
      '.kWWWk.',
      '.kWbWk.',
      '.kWWWk.',
      '.kWwWk.',
      'kRkWkRk',
      'kRkwkRk',
      'kk.o.kk',
      '...y...',
    ],
    ITEM_PAL,
  );
}

/** A soap-bubble shield: the shield pickup and HUD icon. */
export function bubbleIcon(): Raster {
  const r = new Raster(11, 11);
  const rim = hex(ITEM_PAL.n);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      const dx = x + 0.5 - 5.5;
      const dy = y + 0.5 - 5.5;
      const d = Math.hypot(dx, dy);
      if (d > 5.5) continue;
      let c = d > 4.6 ? rim : dx + dy < -3 ? hex(ITEM_PAL.c) : dx + dy > 3 ? hex(ITEM_PAL.s) : hex('#9ff6fb');
      // a window-shaped shine on the upper left
      if ((x === 3 && y >= 3 && y <= 4) || (y === 3 && x === 4)) c = hex(ITEM_PAL.W);
      r.set(x, y, c);
    }
  }
  return r;
}

/** Missiles in flight: the rocket in `directions` headings, frame d pointing at angle d * 2pi / directions - pi/2 (like the cars). */
export function rocketSheet(directions: number): { frame: number; raster: Raster } {
  const src = rocketIcon();
  const big = scale2x(scale2x(scale2x(src)));
  const frame = 16;
  const raster = new Raster(frame * directions, frame);
  for (let d = 0; d < directions; d++) raster.blit(rotSprite(src, (d * Math.PI * 2) / directions, frame, frame, big), d * frame, 0);
  return { frame, raster };
}

/** The shield round a car, seen from above: a thin ring with a shine, drawn half see-through by the views. */
export function shieldRing(): Raster {
  const size = 28;
  const r = new Raster(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d > 13 || d < 11) continue;
      const shine = dx < -4 && dy < -4 && d > 11.6;
      r.set(x, y, shine ? hex(ITEM_PAL.W) : d > 12 ? hex(ITEM_PAL.s) : hex(ITEM_PAL.c));
    }
  }
  return r;
}

const OBSTACLES: Record<ObstacleKind, { rows: string[]; pal: Palette }> = {
  // a round bale fallen off a trailer (the same bales sit in the meadow's fields)
  bale: {
    pal: { k: '#6b412a', Y: '#fff3a0', y: '#ffcd75', o: '#e8a14a', O: '#c27a3a' },
    rows: ['..kkkkk..', '.kYyyyok.', 'kYyoyyyok', 'kyyyoyyOk', 'kyoyyyoOk', '.kooOOOk.', '..kkkkk..'],
  },
  // a wooden keg with iron hoops
  keg: {
    pal: { k: '#3b2016', w: '#e8a14a', T: '#c27a3a', t: '#a0683f', d: '#6b412a', D: '#566c86' },
    rows: ['..kkkk..', '.kwwwwk.', 'kwTwwtwk', 'kkkkkkkk', 'kTtTttdk', 'kDDDDDDk', 'kTtTttdk', 'kTtTttdk', 'kDDDDDDk', 'kTtTttdk', '.kkkkkk.'],
  },
  // a traffic cone with a reflective band
  cone: {
    pal: { k: '#1a1c2c', o: '#ef7d57', O: '#c25a3a', W: '#f4f4f4', w: '#c2c8d6', d: '#333c57' },
    rows: ['....k....', '...kok...', '...kOk...', '..kooOk..', '..kWWwk..', '.kooooOk.', '.koooOOk.', 'kdddddddk', 'kkkkkkkkk'],
  },
};

/** An obstacle standing on the road, drawn upright like the scenery (it stands on its bottom row). */
export function obstacleSprite(kind: ObstacleKind): Raster {
  return fromMap(OBSTACLES[kind].rows, OBSTACLES[kind].pal);
}

/** Bits that fly off an obstacle when it's knocked over (0xRRGGBB). */
export const DEBRIS: Record<ObstacleKind, number[]> = {
  bale: [0xfff3a0, 0xffcd75, 0xe8a14a],
  keg: [0xc27a3a, 0xa0683f, 0x566c86],
  cone: [0xef7d57, 0xf4f4f4, 0xc25a3a],
};

// ---------------------------------------------------------------------------
// Voxel models (x across, y up, z along; each stands on y = 0)
// ---------------------------------------------------------------------------

const V = {
  red: hex('#e43b44'),
  redDark: hex('#b13e53'),
  white: hex('#f4f4f4'),
  grey: hex('#94b0c2'),
  blue: hex('#41a6f6'),
  flame: hex('#ffcd75'),
  woodLight: hex('#e8a14a'),
  wood: hex('#c27a3a'),
  woodDark: hex('#a0683f'),
  iron: hex('#566c86'),
  orange: hex('#ef7d57'),
  orangeDark: hex('#c25a3a'),
  base: hex('#333c57'),
  star: hex('#ffcd75'),
  starShine: hex('#fff3a0'),
};

/** A coin standing on its edge, face towards -z/+z: 7 x 7 x 2. */
export function coinVoxels(): VoxelGrid {
  const g = new VoxelGrid(7, 7, 2);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const dx = x + 0.5 - 3.5;
      const dy = y + 0.5 - 3.5;
      const d = Math.hypot(dx, dy);
      if (d > 3.6) continue;
      const c = d > 2.7 ? GOLD.deep : dx - dy < -2.5 ? GOLD.shine : d < 1.2 ? GOLD.deep : GOLD.gold;
      g.set(x, y, 0, c);
      g.set(x, y, 1, c);
    }
  }
  return g;
}

/** The rocket standing nose up: 5 x 12 x 5, fins at the bottom. Missiles in flight lie it on its side. */
export function rocketVoxels(): VoxelGrid {
  const g = new VoxelGrid(5, 12, 5);
  // fins
  g.box(0, 0, 2, 5, 3, 3, V.red);
  g.box(2, 0, 0, 3, 3, 5, V.redDark);
  // body, with a porthole on each side
  g.box(1, 1, 1, 4, 9, 4, V.white);
  g.box(1, 1, 1, 4, 2, 4, V.grey);
  for (const [x, z] of [[0, 2], [4, 2], [2, 0], [2, 4]]) g.set(x, 6, z, V.blue);
  // nose
  g.box(1, 9, 1, 4, 10, 4, V.red);
  g.box(2, 10, 2, 3, 12, 3, V.red);
  // a lick of flame under the fins
  g.set(2, 0, 2, V.flame);
  return g;
}

/** A wooden keg with two iron hoops: 7 x 9 x 7. */
function kegVoxels(): VoxelGrid {
  const g = new VoxelGrid(7, 9, 7);
  for (let y = 0; y < 9; y++) {
    // a barrel bulges in the middle
    const r = 3.2 + 0.4 * Math.sin((Math.PI * (y + 0.5)) / 9);
    for (let z = 0; z < 7; z++) {
      for (let x = 0; x < 7; x++) {
        const d = Math.hypot(x + 0.5 - 3.5, z + 0.5 - 3.5);
        if (d > r) continue;
        const stave = Math.floor((Math.atan2(z + 0.5 - 3.5, x + 0.5 - 3.5) + Math.PI) * 2) % 2;
        let c = y === 8 ? V.woodLight : stave ? V.wood : V.woodDark;
        if (y === 2 || y === 6) c = V.iron;
        g.set(x, y, z, c);
      }
    }
  }
  return g;
}

/** A traffic cone on its square base: 7 x 10 x 7. */
function coneVoxels(): VoxelGrid {
  const g = new VoxelGrid(7, 10, 7);
  g.box(0, 0, 0, 7, 1, 7, V.base);
  for (let y = 1; y < 10; y++) {
    const r = 3.1 - (y - 1) * 0.33;
    for (let z = 0; z < 7; z++) {
      for (let x = 0; x < 7; x++) {
        const dx = x + 0.5 - 3.5;
        const dz = z + 0.5 - 3.5;
        if (Math.hypot(dx, dz) > Math.max(0.6, r)) continue;
        g.set(x, y, z, y === 4 || y === 5 ? V.white : dx + dz > 1 ? V.orangeDark : V.orange);
      }
    }
  }
  return g;
}

/** The keg or cone (bales use the meadow's hay model, see props3d.ts). */
export function obstacleVoxels(kind: Exclude<ObstacleKind, 'bale'>): VoxelGrid {
  return kind === 'keg' ? kegVoxels() : coneVoxels();
}

/** A little five-point star for a knocked-out car's dizzy spell: 5 x 5 x 1. */
export function starVoxels(): VoxelGrid {
  const g = new VoxelGrid(5, 5, 1);
  const rows = ['..y..', 'yyYyy', '.yYy.', '.y.y.', 'y...y'];
  rows.forEach((row, i) => {
    for (let x = 0; x < 5; x++) if (row[x] !== '.') g.set(x, 4 - i, 0, row[x] === 'Y' ? V.starShine : V.star);
  });
  return g;
}
