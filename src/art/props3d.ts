// Voxel versions of the small scenery (trees, cacti, rocks, lamp posts...)
// for the 3D chase view. Each model stands on y = 0, centred on x = z = 0
// (well, on the middle of its grid). Pure code.
import { hex, rng } from './raster.ts';
import { VoxelGrid } from './voxel.ts';

export interface PropModel {
  grid: VoxelGrid;
  /** Lamp heads and the like: drawn unlit so they glow at night. */
  glow?: VoxelGrid;
}

const P = {
  leafHi: hex('#a7f070'),
  leafLight: hex('#5fc75a'),
  leaf: hex('#38b764'),
  leafDark: hex('#2a8a52'),
  leafDeep: hex('#1e5e43'),
  bark: hex('#a0683f'),
  barkDark: hex('#6b412a'),
  stone: hex('#c2c8d6'),
  stoneMid: hex('#94b0c2'),
  stoneDark: hex('#6f7d96'),
  stoneDeep: hex('#566c86'),
  hay: hex('#fff3a0'),
  hayMid: hex('#ffcd75'),
  hayDark: hex('#e8a14a'),
  hayDeep: hex('#c27a3a'),
  cactusHi: hex('#a7f070'),
  cactus: hex('#4fc06a'),
  cactusMid: hex('#2f9a5a'),
  cactusDark: hex('#257151'),
  flower: hex('#f47e9b'),
  sand: hex('#e8a46b'),
  sandMid: hex('#d98b4e'),
  sandDark: hex('#b86b40'),
  sandDeep: hex('#8f4f32'),
  weed: hex('#b98a4a'),
  weedDark: hex('#7a5a3a'),
  concrete: hex('#8f95ad'),
  concreteDark: hex('#5b6080'),
  planterLeaf: hex('#3aa76d'),
  planterLeafDark: hex('#257151'),
  pole: hex('#8f95ad'),
  poleDark: hex('#14151f'),
  lampHead: hex('#fff3a0'),
};

/** Fills an ellipsoid (centre cx,cy,cz; radii rx,ry,rz) with colours picked per voxel. */
function blob(g: VoxelGrid, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, colour: (x: number, y: number, z: number, t: number) => number, lumpy = 0, seed = 1): void {
  const R = rng(seed);
  const bumps = Array.from({ length: 6 }, () => [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1, R() * lumpy]);
  for (let z = 0; z < g.sz; z++) {
    for (let y = 0; y < g.sy; y++) {
      for (let x = 0; x < g.sx; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const dz = (z + 0.5 - cz) / rz;
        let d = dx * dx + dy * dy + dz * dz;
        for (const [bx, by, bz, a] of bumps) d -= a * Math.max(0, dx * bx + dy * by + dz * bz);
        if (d <= 1) g.set(x, y, z, colour(x, y, z, d));
      }
    }
  }
}

/** Light from the upper left, like the overhead sprites: picks one of five shades. */
function shaded(shades: number[], seed: number) {
  const R = rng(seed);
  const noise = new Map<string, number>();
  return (cx: number, cy: number, cz: number) => (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    if (!noise.has(k)) noise.set(k, R());
    const lit = (y + 0.5 - cy) * 0.55 - (x + 0.5 - cx) * 0.25 - (z + 0.5 - cz) * 0.25 + (noise.get(k)! - 0.5) * 0.5;
    const i = lit > 2.2 ? 0 : lit > 0.6 ? 1 : lit > -0.8 ? 2 : lit > -2.2 ? 3 : 4;
    return shades[i];
  };
}

function tree(seed: number): PropModel {
  const g = new VoxelGrid(13, 17, 13);
  g.box(5, 0, 5, 8, 6, 8, P.barkDark);
  g.box(6, 0, 6, 7, 6, 7, P.bark);
  const leaves = shaded([P.leafHi, P.leafLight, P.leaf, P.leafDark, P.leafDeep], seed)(6.5, 11, 6.5);
  blob(g, 6.5, 11, 6.5, 6.3, 5.6, 6.3, leaves, 0.25, seed);
  return { grid: g };
}

function pine(seed: number): PropModel {
  const g = new VoxelGrid(11, 18, 11);
  g.box(4, 0, 4, 7, 4, 7, P.barkDark);
  const leaves = shaded([P.leafHi, P.leafLight, P.leaf, P.leafDark, P.leafDeep], seed)(5.5, 10, 5.5);
  const tiers: [number, number, number][] = [
    [3, 5.4, 6],
    [8, 4.2, 5],
    [12, 2.8, 4],
  ];
  for (const [y0, r, h] of tiers) {
    for (let y = y0; y < y0 + h; y++) {
      const rr = r * (1 - (y - y0) / (h + 0.6)) + 0.5;
      for (let z = 0; z < g.sz; z++)
        for (let x = 0; x < g.sx; x++) if (Math.hypot(x + 0.5 - 5.5, z + 0.5 - 5.5) <= rr) g.set(x, y, z, leaves(x, y, z));
    }
  }
  g.box(5, 15, 5, 6, 17, 6, P.leafLight);
  return { grid: g };
}

function bush(seed: number): PropModel {
  const g = new VoxelGrid(10, 6, 10);
  blob(g, 5, 1.5, 5, 4.8, 4.2, 4.6, shaded([P.leafHi, P.leafLight, P.leaf, P.leafDark, P.leafDeep], seed)(5, 2, 5), 0.3, seed);
  return { grid: g };
}

function rock(seed: number): PropModel {
  const g = new VoxelGrid(9, 6, 8);
  blob(g, 4.5, 0.8, 4, 4.4, 4.8, 3.8, shaded([P.stone, P.stoneMid, P.stoneMid, P.stoneDark, P.stoneDeep], seed)(4.5, 2, 4), 0.35, seed);
  return { grid: g };
}

function desertRock(seed: number): PropModel {
  const g = new VoxelGrid(12, 6, 9);
  blob(g, 6, 0.6, 4.5, 5.8, 5.2, 4.3, shaded([P.sand, P.sandMid, P.sandMid, P.sandDark, P.sandDeep], seed)(6, 2, 4.5), 0.35, seed);
  return { grid: g };
}

function hay(): PropModel {
  // a round bale lying on its side, the spiral showing on its ends
  const g = new VoxelGrid(9, 8, 8);
  for (let z = 0; z < 8; z++) {
    for (let y = 0; y < 8; y++) {
      const d = Math.hypot(y + 0.5 - 4, z + 0.5 - 4);
      if (d > 4) continue;
      for (let x = 0; x < 9; x++) {
        const end = x === 0 || x === 8;
        const c = end ? (Math.floor(d * 1.3) % 2 ? P.hayDark : P.hayMid) : y > 5 ? P.hay : y > 2 ? P.hayMid : P.hayDeep;
        g.set(x, y, z, c);
      }
    }
  }
  return { grid: g };
}

function cactus(seed: number): PropModel {
  const R = rng(seed);
  const g = new VoxelGrid(11, 15, 5);
  const col = (x: number, y: number, z: number) => (x === 4 || z === 1 ? P.cactusHi : (x + y) % 3 === 0 ? P.cactusMid : P.cactus);
  for (let y = 0; y < 14; y++) for (let z = 1; z < 4; z++) for (let x = 4; x < 7; x++) g.set(x, y, z, col(x, y, z));
  g.box(5, 14, 2, 6, 15, 3, P.cactus);
  // two arms, left lower than right
  const armL = 4 + Math.floor(R() * 3);
  const armR = 6 + Math.floor(R() * 3);
  for (let x = 1; x < 4; x++) g.set(x, armL, 2, P.cactusMid);
  for (let y = armL; y < armL + 5; y++) g.set(1, y, 2, y === armL + 4 ? P.cactusHi : P.cactus);
  for (let x = 7; x < 10; x++) g.set(x, armR, 2, P.cactusMid);
  for (let y = armR; y < armR + 4; y++) g.set(9, y, 2, y === armR + 3 ? P.cactusHi : P.cactus);
  return { grid: g };
}

function barrel(): PropModel {
  // a barrel cactus: a ribbed green dome with a pink flower on top
  const g = new VoxelGrid(7, 7, 7);
  blob(g, 3.5, 1.5, 3.5, 3.4, 4.6, 3.4, (x, _y, z) => (Math.floor(Math.atan2(z + 0.5 - 3.5, x + 0.5 - 3.5) * 2.5 + 8) % 2 ? P.cactus : P.cactusMid));
  g.box(3, 6, 3, 4, 7, 4, P.flower);
  g.set(2, 6, 3, P.flower);
  g.set(4, 6, 3, P.flower);
  return { grid: g };
}

function weed(seed: number): PropModel {
  // tumbleweed: a loose ball of twigs
  const R = rng(seed);
  const g = new VoxelGrid(6, 6, 6);
  blob(g, 3, 3, 3, 2.9, 2.9, 2.9, () => (R() < 0.45 ? 0 : R() < 0.5 ? P.weed : P.weedDark));
  return { grid: g };
}

function planter(seed: number): PropModel {
  const g = new VoxelGrid(9, 7, 6);
  g.box(0, 0, 0, 9, 3, 6, P.concrete);
  g.box(0, 0, 0, 9, 1, 6, P.concreteDark);
  blob(g, 4.5, 3, 3, 4, 3.4, 2.6, shaded([P.planterLeaf, P.planterLeaf, P.planterLeafDark, P.planterLeafDark, P.leafDeep], seed)(4.5, 4, 3), 0.3, seed);
  return { grid: g };
}

function lamp(): PropModel {
  const g = new VoxelGrid(5, 15, 5);
  g.box(1, 0, 1, 4, 1, 4, P.poleDark);
  g.box(2, 1, 2, 3, 13, 3, P.pole);
  g.box(1, 13, 1, 4, 14, 4, P.poleDark);
  const glow = new VoxelGrid(5, 15, 5);
  glow.box(1, 12, 1, 4, 13, 4, P.lampHead);
  return { grid: g, glow };
}

/** Voxel model for a prop name used by the track painter. */
export function propModel(name: string, variant = 0): PropModel {
  const seed = 7 + variant * 101;
  switch (name) {
    case 'tree':
      return tree(seed);
    case 'pine':
      return pine(seed);
    case 'bush':
      return bush(seed);
    case 'rock':
      return rock(seed);
    case 'hay':
      return hay();
    case 'cactus':
      return cactus(seed);
    case 'barrel':
      return barrel();
    case 'desertRock':
      return desertRock(seed);
    case 'weed':
      return weed(seed);
    case 'planter':
      return planter(seed);
    case 'lamp':
      return lamp();
    default:
      return rock(seed);
  }
}

/** How many differently shaped versions to make of each prop. */
export function propVariants(name: string): number {
  return name === 'tree' || name === 'bush' || name === 'rock' || name === 'cactus' || name === 'desertRock' ? 3 : 1;
}
