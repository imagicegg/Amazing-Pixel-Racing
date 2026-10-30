// Everything that stands still in the 3D chase view (the rolling ground,
// barriers, bridges, scenery, buildings, mesas, the grandstand), built once
// per track from what the overhead painter placed, and kept while the
// player stays on that track so restarts are instant.
import * as THREE from 'three';
import { Raster, hash2, hex } from '../art/raster.ts';
import { halfVoxels, meshVoxels, type MeshData, type VoxelGrid } from '../art/voxel.ts';
import { propModel, propVariants } from '../art/props3d.ts';
import { propSprite, type DeckArt } from '../tracks/paint.ts';
import { barrierSpots, blitPadded, boulder, buildingFaces, concreteBlock, mesaVoxels, packAtlas, standVoxels, startGantry, stoneParapet, timberRail, trackIsNorth, tyreStack, type BarrierSpot, type BuildingFaces } from '../tracks/scenery3d.ts';
import { CURB_WIDTH, WALL_THICKNESS, gradeAt, heightAt, pointAt, type DeckSpan, type TrackGeometry } from '../tracks/geometry.ts';
import { terrainAt, type Terrain } from '../tracks/terrain.ts';
import type { LoadedTrack } from '../tracks/trackCache.ts';
import type { Theme } from '../tracks/themes.ts';

/**
 * A square of instanced scenery. Up close it shows the detailed models,
 * further away half-resolution stand-ins, and beyond the draw distance
 * nothing (the fog has nearly swallowed it by then).
 */
export interface Chunk {
  /** Centre, in world px. */
  x: number;
  z: number;
  near: THREE.Object3D[];
  far: THREE.Object3D[];
  /** Models without a stand-in. */
  always: THREE.Object3D[];
}

/**
 * A bridge in 3D. Its deck and railings have their own materials, so the
 * chase view can make them see-through while your car is underneath.
 */
export interface Bridge3D {
  span: DeckSpan;
  materials: THREE.Material[];
}

export interface World3D {
  key: string;
  group: THREE.Group;
  chunks: Chunk[];
  bridges: Bridge3D[];
  /** The painted ground; tyre marks are painted into it during a race. */
  ground: THREE.DataTexture;
  /** True once tyre marks have changed `ground`. */
  marked: boolean;
  dispose(): void;
}

/** Instanced scenery is grouped into squares this big, so whole squares out of view are skipped. */
export const CHUNK = 320;

/** Packed raster colour (ABGR) -> three.js colour number (0xRRGGBB). */
export const rgb = (c: number) => ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff);

/** Raster -> texture with crisp pixels up close and smooth mipmaps far away. */
export function rasterTexture(r: Raster, anisotropy: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(r.px.buffer.slice(r.px.byteOffset, r.px.byteOffset + r.px.byteLength)), r.w, r.h);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/**
 * Voxel mesh data -> geometry, scaled by `scale` then moved by (ox, oy, oz).
 * Voxel axes are world axes here (x east, y up, z south).
 */
export function voxelGeometry(m: MeshData, ox = 0, oy = 0, oz = 0, scale = 1): THREE.BufferGeometry {
  const pos = new Float32Array(m.positions.length);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = m.positions[i] * scale + ox;
    pos[i + 1] = m.positions[i + 1] * scale + oy;
    pos[i + 2] = m.positions[i + 2] * scale + oz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/** Several voxel meshes, each at its own offset, as one geometry (one draw call). */
function mergedVoxels(parts: { grid: VoxelGrid; x: number; y: number; z: number }[]): THREE.BufferGeometry {
  const meshes = parts.map((p) => ({ m: meshVoxels(p.grid), p }));
  const verts = meshes.reduce((n, { m }) => n + m.positions.length, 0);
  const tris = meshes.reduce((n, { m }) => n + m.indices.length, 0);
  const pos = new Float32Array(verts);
  const nrm = new Float32Array(verts);
  const col = new Float32Array(verts);
  const idx = new Uint32Array(tris);
  let v = 0;
  let t = 0;
  for (const { m, p } of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      pos[v + i] = m.positions[i] + p.x;
      pos[v + i + 1] = m.positions[i + 1] + p.y;
      pos[v + i + 2] = m.positions[i + 2] + p.z;
    }
    nrm.set(m.normals, v);
    col.set(m.colors, v);
    for (let i = 0; i < m.indices.length; i++) idx[t + i] = m.indices[i] + v / 3;
    v += m.positions.length;
    t += m.indices.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** A flat quad on the ground, facing up, optionally with 0..1 texture coordinates. */
export function groundQuad(x0: number, z0: number, x1: number, z1: number, uv = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  // counter-clockwise seen from above, so the face points up
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

interface Placement {
  x: number;
  z: number;
  /** Height of its foot (the ground or the road under it). */
  y: number;
  angle: number;
  scale: number;
  colour?: number;
}

type Own = <T extends { dispose(): void }>(t: T) => T;

/** Where instanced scenery goes: the scene graph, and the chunk it belongs to. */
interface Sink {
  group: THREE.Group;
  chunks: Map<string, Chunk>;
  own: Own;
}

/** A voxel model as geometry centred on its footprint, plus (optionally) a half-resolution stand-in. */
function centred(grid: VoxelGrid, own: Own, lod: boolean): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const full = own(voxelGeometry(meshVoxels(grid), -grid.sx / 2, 0, -grid.sz / 2));
  if (!lod) return [full, null];
  return [full, own(voxelGeometry(meshVoxels(halfVoxels(grid)), -grid.sx / 2, 0, -grid.sz / 2, 2))];
}

/** Instanced copies of one model, split into chunks so off-screen chunks are culled. */
function instanced(sink: Sink, [geo, lodGeo]: [THREE.BufferGeometry, THREE.BufferGeometry | null], mat: THREE.Material, list: Placement[], shadows: boolean): void {
  const { group, own } = sink;
  const chunks = new Map<string, Placement[]>();
  for (const p of list) {
    const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = []));
    c.push(p);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const colour = new THREE.Color();
  for (const [key, items] of chunks) {
    const make = (g: THREE.BufferGeometry) => {
      const mesh = own(new THREE.InstancedMesh(g, mat, items.length));
      items.forEach((p, i) => {
        // models face +x; three.js turns counter-clockwise seen from above
        q.setFromAxisAngle(up, -p.angle);
        m.compose(pos.set(p.x, p.y, p.z), q, scl.set(p.scale, p.scale, p.scale));
        mesh.setMatrixAt(i, m);
        if (p.colour !== undefined) mesh.setColorAt(i, colour.setHex(p.colour));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
      return mesh;
    };
    let chunk = sink.chunks.get(key);
    if (!chunk) {
      const [cx, cz] = key.split(',').map(Number);
      chunk = { x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, near: [], far: [], always: [] };
      sink.chunks.set(key, chunk);
    }
    if (lodGeo) {
      chunk.near.push(make(geo));
      chunk.far.push(make(lodGeo));
    } else chunk.always.push(make(geo));
  }
}

/** One quad of a building, corners given top-left, top-right, bottom-right, bottom-left as seen from outside. */
function face(out: { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }, c: number[][], n: number[], uv: number[][]): void {
  const base = out.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    out.pos.push(...c[k]);
    out.nrm.push(...n);
    out.uv.push(...uv[k]);
  }
  out.idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
}

function buildings(group: THREE.Group, list: BuildingFaces[], terrain: Terrain, night: boolean, anisotropy: number, own: <T extends { dispose(): void }>(t: T) => T): void {
  const faces = list.flatMap((b) => b.faces);
  const atlas = packAtlas(faces.map((f) => ({ w: f.w, h: f.h })));
  const colour = new Raster(atlas.w, atlas.h);
  const glow = new Raster(atlas.w, atlas.h);
  faces.forEach((f, i) => blitPadded(colour, f, atlas.rects[i]));
  list.flatMap((b) => b.glow).forEach((f, i) => blitPadded(glow, f, atlas.rects[i]));
  const out = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  let k = 0;
  for (const b of list) {
    // on a slope it stands on the lowest corner, its walls a little taller to stay level
    const [lo, hi] = groundRange(terrain, b.x, b.y, b.w, b.d);
    const [x0, z0, x1, z1, y0, h] = [b.x, b.y, b.x + b.w, b.y + b.d, lo - 1, hi + b.h];
    // texture corners of rect i: top-left, top-right, bottom-right, bottom-left
    const uvOf = (i: number) => {
      const r = atlas.rects[i];
      const u0 = r.x / atlas.w;
      const u1 = (r.x + r.w) / atlas.w;
      const v0 = r.y / atlas.h;
      const v1 = (r.y + r.h) / atlas.h;
      return [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
    };
    // roof: its drawing's top row is the north edge
    face(out, [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], [0, 1, 0], uvOf(k));
    face(out, [[x1, h, z0], [x0, h, z0], [x0, y0, z0], [x1, y0, z0]], [0, 0, -1], uvOf(k + 1));
    face(out, [[x0, h, z1], [x1, h, z1], [x1, y0, z1], [x0, y0, z1]], [0, 0, 1], uvOf(k + 2));
    face(out, [[x0, h, z0], [x0, h, z1], [x0, y0, z1], [x0, y0, z0]], [-1, 0, 0], uvOf(k + 3));
    face(out, [[x1, h, z1], [x1, h, z0], [x1, y0, z0], [x1, y0, z1]], [1, 0, 0], uvOf(k + 4));
    k += 5;
  }
  const geo = own(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setIndex(out.idx);
  const mat = own(
    new THREE.MeshLambertMaterial({
      map: own(rasterTexture(colour, anisotropy)),
      emissiveMap: night ? own(rasterTexture(glow, anisotropy)) : null,
      emissive: night ? 0xffffff : 0x000000,
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Lowest and highest ground under a rectangle (sampled at its corners, edges and middle). */
function groundRange(t: Terrain, x: number, y: number, w: number, d: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      const h = terrainAt(t, x + (w * i) / 2, y + (d * j) / 2);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return [lo, hi];
}

/** Grid cells per side of one piece of the ground mesh (pieces out of view are skipped). */
const GROUND_PIECE = 48;

/** The painted ground laid over the terrain's height grid, in square pieces. */
function groundMeshes(group: THREE.Group, t: Terrain, w: number, h: number, mat: THREE.Material, own: Own): void {
  const { cols, rows, step } = t;
  const at = (c: number, r: number) => t.h[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r0 = 0; r0 < rows - 1; r0 += GROUND_PIECE) {
    for (let c0 = 0; c0 < cols - 1; c0 += GROUND_PIECE) {
      const vc = Math.min(GROUND_PIECE, cols - 1 - c0) + 1;
      const vr = Math.min(GROUND_PIECE, rows - 1 - r0) + 1;
      const pos = new Float32Array(vc * vr * 3);
      const nrm = new Float32Array(vc * vr * 3);
      const uv = new Float32Array(vc * vr * 2);
      for (let j = 0; j < vr; j++) {
        for (let i = 0; i < vc; i++) {
          const c = c0 + i;
          const r = r0 + j;
          const v = j * vc + i;
          const x = c * step;
          const z = r * step;
          pos.set([x, at(c, r), z], v * 3);
          // slope from the neighbours: the face leans away from the way the ground rises
          const gx = (at(c + 1, r) - at(c - 1, r)) / (2 * step);
          const gz = (at(c, r + 1) - at(c, r - 1)) / (2 * step);
          const l = Math.hypot(gx, 1, gz);
          nrm.set([-gx / l, 1 / l, -gz / l], v * 3);
          uv.set([x / w, z / h], v * 2);
        }
      }
      const idx: number[] = [];
      for (let j = 0; j + 1 < vr; j++) {
        for (let i = 0; i + 1 < vc; i++) {
          const a = j * vc + i;
          // north-west, south-east, north-east; north-west, south-west, south-east (faces up)
          idx.push(a, a + vc + 1, a + 1, a, a + vc, a + vc + 1);
        }
      }
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

/** A deck's slab is this thick, px. */
const DECK_THICK = 6;
/** Piers stand about this far apart along a bridge, px. */
const PIER_STEP = 64;

/** Bridge looks per theme: the slab's sides, and the piers that hold it up. */
const BRIDGE_STYLE: Record<string, { side: number; under: number; pier: number; cols: number[]; post: number; beam: boolean }> = {
  // stone piers as wide as the road
  meadow: { side: 0xa9b2c6, under: 0x6f7d96, pier: 0xa9b2c6, cols: [0], post: 0, beam: false },
  // a timber trestle: three posts under a cross beam
  canyon: { side: 0x8f5a36, under: 0x5d3b24, pier: 0x8f5a36, cols: [-0.85, 0, 0.85], post: 5, beam: true },
  // concrete columns
  city: { side: 0x8f95ad, under: 0x3a3f5c, pier: 0x8f95ad, cols: [-0.6, 0.6], post: 10, beam: true },
};

/** The overhead painting of a deck with its edge pixels spread outwards, so filtering never pulls in the clear border. */
function deckTexture(art: DeckArt): Raster {
  const src = art.raster;
  const r = src.clone();
  for (let pass = 0; pass < 3; pass++) {
    const prev = r.px.slice();
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const o = y * r.w + x;
        if (prev[o] >>> 24) continue;
        const n = (x > 0 && prev[o - 1] >>> 24 ? prev[o - 1] : 0) || (x + 1 < r.w && prev[o + 1] >>> 24 ? prev[o + 1] : 0) || (y > 0 && prev[o - r.w] >>> 24 ? prev[o - r.w] : 0) || (y + 1 < r.h && prev[o + r.w] >>> 24 ? prev[o + r.w] : 0);
        if (n) r.px[o] = n;
      }
    }
  }
  return r;
}

/**
 * The bridges: a slab along each deck with the deck's painting on top, the
 * theme's railings along its edges, and piers wherever they can stand clear
 * of the roads below.
 */
function bridges(sink: Sink, track: LoadedTrack, theme: Theme, anisotropy: number): Bridge3D[] {
  const { group, own } = sink;
  const g = track.geom;
  const t = track.terrain;
  const style = BRIDGE_STYLE[theme.id];
  const edge = g.wallDist + WALL_THICKNESS - 0.5;
  // railings, shared by all the decks, in materials of their own so they can fade
  const railMat = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const railGlow = own(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const spots = barrierSpots(g, 6).filter((sp) => sp.deck);
  const neon = theme.wall === 'barrier';
  const rails = spots.map((sp) => ({ x: sp.x, z: sp.y, y: sp.z, angle: sp.angle, scale: 1, colour: neon ? (Math.floor(sp.s / 48) & 1 ? 0xff4fd8 : 0x41e6ff) : undefined }));
  if (theme.wall === 'tires') instanced(sink, centred(stoneParapet(), own, false), railMat, rails, true);
  else if (!neon) instanced(sink, centred(timberRail(), own, false), railMat, rails, true);
  else {
    const { block, neon } = concreteBlock();
    instanced(sink, centred(block, own, false), railMat, rails, true);
    instanced(sink, centred(neon, own, false), railGlow, rails, false);
  }
  const pierMat = own(new THREE.MeshLambertMaterial({ color: style.pier }));
  const box = own(new THREE.BoxGeometry(1, 1, 1));
  const piers: THREE.Matrix4[] = [];
  const out: Bridge3D[] = [];
  for (const art of track.decks) {
    const span = art.span;
    const topMat = own(new THREE.MeshLambertMaterial({ map: own(rasterTexture(deckTexture(art), anisotropy)) }));
    const sideMat = own(new THREE.MeshLambertMaterial({ color: style.side }));
    const underMat = own(new THREE.MeshLambertMaterial({ color: style.under }));
    const top = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
    const sides = { pos: [] as number[], nrm: [] as number[], idx: [] as number[] };
    const under = { pos: [] as number[], nrm: [] as number[], idx: [] as number[] };
    const count = span.b - span.a + 1;
    for (let k = 0; k < count; k++) {
      const i = (span.a + k) % g.n;
      const x = g.x[i];
      const z = g.y[i];
      const y = g.h[i];
      // right of the driving direction
      const rx = -g.ty[i];
      const rz = g.tx[i];
      const grade = gradeAt(g, i * g.ds);
      const l = Math.hypot(grade, 1);
      for (const side of [-1, 1]) {
        const px = x + rx * side * edge;
        const pz = z + rz * side * edge;
        top.pos.push(px, y, pz);
        top.nrm.push((-grade * g.tx[i]) / l, 1 / l, (-grade * g.ty[i]) / l);
        top.uv.push((px - art.x) / art.raster.w, (pz - art.y) / art.raster.h);
        // the slab's sides: top and bottom edge
        sides.pos.push(px, y, pz, px, y - DECK_THICK, pz);
        sides.nrm.push(rx * side, 0, rz * side, rx * side, 0, rz * side);
        under.pos.push(px, y - DECK_THICK, pz);
        under.nrm.push(0, -1, 0);
      }
      if (k === 0) continue;
      // this section and the one before: left and right corners
      const L0 = (k - 1) * 2;
      const R0 = L0 + 1;
      const L1 = k * 2;
      const R1 = L1 + 1;
      top.idx.push(L0, R1, L1, L0, R0, R1);
      under.idx.push(L0, L1, R1, L0, R1, R0);
      // side vertices: per section, left top/bottom then right top/bottom
      const lt0 = (k - 1) * 4;
      const lb0 = lt0 + 1;
      const rt0 = lt0 + 2;
      const rb0 = lt0 + 3;
      const lt1 = k * 4;
      const lb1 = lt1 + 1;
      const rt1 = lt1 + 2;
      const rb1 = lt1 + 3;
      sides.idx.push(rb0, rb1, rt1, rb0, rt1, rt0, lb1, lb0, lt0, lb1, lt0, lt1);
    }
    const mesh = (m: { pos: number[]; nrm: number[]; idx: number[]; uv?: number[] }, mat: THREE.Material) => {
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.nrm, 3));
      if (m.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      geo.setIndex(m.idx);
      const ms = new THREE.Mesh(geo, mat);
      ms.castShadow = true;
      ms.receiveShadow = true;
      group.add(ms);
    };
    mesh(top, topMat);
    mesh(sides, sideMat);
    mesh(under, underMat);
    out.push({ span, materials: [topMat, sideMat, underMat, railMat, railGlow] });

    // piers: at both ends and every PIER_STEP between, where every post stands clear of the roads below
    const len = (span.b - span.a) * g.ds;
    const bents = Math.max(1, Math.round(len / PIER_STEP));
    for (let q = 0; q <= bents; q++) {
      const s = span.a * g.ds + Math.min(len - 3, Math.max(3, (q / bents) * len));
      const p = pointAt(g, s);
      const deckY = heightAt(g, s) - DECK_THICK;
      const posts = style.cols.map((f) => pointAt(g, s, f * (style.post ? g.wallDist : 0)));
      const wide = style.post === 0;
      const reach = wide ? g.wallDist : style.post;
      if (posts.some((pp) => roadBelow(g, pp.x, pp.y, reach, deckY))) continue;
      const foot = Math.min(...posts.map((pp) => terrainAt(t, pp.x, pp.y))) - 2;
      if (deckY - foot < 3) continue;
      const m = new THREE.Matrix4();
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.angle);
      for (const pp of posts) {
        const w = wide ? 2 * (g.wallDist - 2) : style.post;
        const d = wide ? 12 : style.post;
        piers.push(m.clone().compose(new THREE.Vector3(pp.x, (foot + deckY) / 2, pp.y), rot, new THREE.Vector3(d, deckY - foot, w)));
      }
      // a cross beam under the deck ties the posts together
      if (style.beam) piers.push(m.clone().compose(new THREE.Vector3(p.x, deckY - 2.5, p.y), rot, new THREE.Vector3(style.post, 5, 2 * g.wallDist)));
    }
  }
  if (piers.length) {
    const im = own(new THREE.InstancedMesh(box, pierMat, piers.length));
    piers.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  }
  return out;
}

/**
 * Would a post `pad` px across at (x, y) stand on a road passing under the
 * deck (one lower than `deckY`)? The road running onto the deck doesn't count.
 */
function roadBelow(g: TrackGeometry, x: number, y: number, pad: number, deckY: number): boolean {
  for (let dy = -pad; dy <= pad; dy += 3) {
    for (let dx = -pad; dx <= pad; dx += 3) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= g.width || py >= g.height || dx * dx + dy * dy > pad * pad) continue;
      const i = g.seg[py * g.width + px];
      if (i >= 0 && g.h[i] < deckY - 8) return true;
    }
  }
  return false;
}

function build(track: LoadedTrack, theme: Theme, anisotropy: number): World3D {
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(t: T): T => {
    disposables.push(t);
    return t;
  };
  const group = new THREE.Group();
  const g = track.geom;
  const r = track.raster;

  // the painted ground over the lie of the land, and plain ground all the way to the horizon around it
  const ground = own(rasterTexture(r, anisotropy));
  groundMeshes(group, track.terrain, r.w, r.h, own(new THREE.MeshLambertMaterial({ map: ground })), own);
  const outside = own(new THREE.MeshLambertMaterial({ color: rgb(hex(theme.ground.base)) }));
  const far = 40000;
  for (const [x0, z0, x1, z1] of [
    [-far, -far, far, 0],
    [-far, r.h, far, far],
    [-far, 0, 0, r.h],
    [r.w, 0, far, r.h],
  ]) {
    group.add(new THREE.Mesh(own(groundQuad(x0, z0, x1, z1)), outside));
  }

  const voxelMat = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const glowMat = own(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const sink: Sink = { group, chunks: new Map(), own };

  // trees, cacti, rocks, lamp posts...
  const terrain = track.terrain;
  const byModel = new Map<string, Placement[]>();
  for (const pr of track.props) {
    const sprite = propSprite(pr.name);
    const lamp = pr.name === 'lamp';
    const variant = Math.floor(hash2(pr.x, pr.y, 11) * propVariants(pr.name));
    const key = `${pr.name}:${variant}`;
    let list = byModel.get(key);
    if (!list) byModel.set(key, (list = []));
    // lamp posts stand where the drawing's foot is; the rest sit in the middle of their patch
    const x = pr.x + sprite.w / 2;
    const z = lamp ? pr.y + sprite.h - 2 : pr.y + sprite.h / 2;
    list.push({
      x,
      z,
      // a little sunk into the ground, so slopes don't leave them floating
      y: terrainAt(terrain, x, z) - 0.5,
      angle: lamp ? 0 : hash2(pr.x, pr.y, 5) * Math.PI * 2,
      scale: lamp ? 1 : 0.9 + hash2(pr.x, pr.y, 7) * 0.25,
    });
  }
  for (const [key, list] of byModel) {
    const [name, variant] = key.split(':');
    const model = propModel(name, Number(variant));
    instanced(sink, centred(model.grid, own, true), voxelMat, list, true);
    if (model.glow) instanced(sink, centred(model.glow, own, false), glowMat, list, false);
  }

  // barriers along both walls, where the overhead view paints them (bridges get railings instead)
  const onGround = (list: BarrierSpot[]) => list.filter((sp) => !sp.deck);
  if (theme.wall === 'tires') {
    const spots = onGround(barrierSpots(g, 7)).map((sp) => {
      const q = Math.floor(sp.s / 8);
      return { x: sp.x, z: sp.y, y: sp.z, angle: sp.angle, scale: 1, colour: q % 2 === 0 ? 0x3a3d4a : q % 4 === 1 ? 0xe43b44 : 0xf4f4f4 };
    });
    instanced(sink, centred(tyreStack(), own, true), voxelMat, spots, true);
  } else if (theme.wall === 'rocks') {
    const spots = onGround(barrierSpots(g, 8));
    for (let v = 0; v < 3; v++) {
      const grid = boulder(31 + v * 17);
      const list = spots
        .filter((_, i) => i % 3 === v)
        .map((sp) => ({ x: sp.x, z: sp.y, y: sp.z - 1, angle: hash2(sp.x | 0, sp.y | 0, 3) * Math.PI * 2, scale: 1.8 + hash2(sp.x | 0, sp.y | 0, 4) * 0.5 }));
      instanced(sink, centred(grid, own, false), voxelMat, list, true);
    }
  } else {
    const spots = onGround(barrierSpots(g, 6)).map((sp) => ({
      x: sp.x,
      z: sp.y,
      y: sp.z,
      angle: sp.angle,
      scale: 1,
      colour: Math.floor(sp.s / 48) & 1 ? 0xff4fd8 : 0x41e6ff,
    }));
    const { block, neon } = concreteBlock();
    instanced(sink, centred(block, own, false), voxelMat, spots, true);
    instanced(sink, centred(neon, own, false), glowMat, spots, false);
  }

  const bridges3d = bridges(sink, track, theme, anisotropy);

  // the start/finish gantry
  const start = pointAt(g, 0);
  const span = Math.round(2 * (g.halfWidth + CURB_WIDTH + 6));
  const gate = startGantry(span, theme.id);
  for (const [grid, mat] of [[gate.grid, voxelMat], [gate.glow, glowMat]] as const) {
    if (!grid) continue;
    const mesh = new THREE.Mesh(own(voxelGeometry(meshVoxels(grid), -grid.sx / 2, 0, -span / 2)), mat);
    mesh.position.set(start.x, heightAt(g, 0), start.y);
    mesh.rotation.y = -start.angle;
    mesh.castShadow = mat === voxelMat;
    mesh.receiveShadow = mat === voxelMat;
    group.add(mesh);
  }

  // big scenery: buildings, mesas, the grandstand
  const towers = track.blocks.filter((b) => b.kind === 'building').map((b, i) => buildingFaces(b, i));
  if (towers.length) buildings(group, towers, terrain, theme.night, anisotropy, own);
  const mesas = track.blocks.filter((b) => b.kind === 'mesa').map((b) => {
    const m = mesaVoxels(b);
    return { grid: m.grid, x: m.x, y: groundRange(terrain, m.x, m.y, m.grid.sx, m.grid.sz)[0] - 1, z: m.y };
  });
  const stands = track.blocks
    .filter((b) => b.kind === 'stand')
    .map((b) => ({ grid: standVoxels(b, trackIsNorth(g, b)), x: b.x, y: groundRange(terrain, b.x, b.y, b.art.w, b.art.h)[0] - 1, z: b.y }));
  const solids = [...mesas, ...stands];
  if (solids.length) {
    const mesh = new THREE.Mesh(own(mergedVoxels(solids)), voxelMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    key: track.key,
    group,
    chunks: [...sink.chunks.values()],
    bridges: bridges3d,
    ground,
    marked: false,
    dispose: () => {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}

let cached: World3D | null = null;

/** The 3D world for a track: built on first use, then reused for restarts on the same track. */
export function worldFor(track: LoadedTrack, theme: Theme, anisotropy: number): World3D {
  if (cached && cached.key === track.key) {
    if (cached.marked) {
      // wipe the last race's tyre marks
      const r = track.raster;
      (cached.ground.image.data as Uint8Array).set(new Uint8Array(r.px.buffer, r.px.byteOffset, r.px.byteLength));
      cached.ground.needsUpdate = true;
      cached.marked = false;
    }
    return cached;
  }
  cached?.dispose();
  cached = build(track, theme, anisotropy);
  return cached;
}
