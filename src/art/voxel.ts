// Voxels: little 3D pixel grids for the cars and scenery of the 3D chase view,
// and a mesher that turns them into as few flat quads as possible.
// Pure code, no three.js, so Node can test it.

/** A box of voxels. Axes: x across, y up, z along; colour 0 = empty. */
export class VoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly c: Uint32Array;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.c = new Uint32Array(sx * sy * sz);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.c[(z * this.sy + y) * this.sx + x] : 0;
  }

  set(x: number, y: number, z: number, color: number): void {
    if (this.inside(x, y, z)) this.c[(z * this.sy + y) * this.sx + x] = color;
  }

  /** Fills a box (inclusive start, exclusive end), clipped to the grid. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
    for (let z = Math.max(0, z0); z < Math.min(this.sz, z1); z++)
      for (let y = Math.max(0, y0); y < Math.min(this.sy, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(this.sx, x1); x++) this.c[(z * this.sy + y) * this.sx + x] = color;
  }

  count(): number {
    let n = 0;
    for (const v of this.c) if (v) n++;
    return n;
  }
}

/** Flat-shaded triangle mesh: per-vertex position, face normal and RGB colour (0..1). */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/**
 * Greedy meshing: every visible voxel face, merged with its neighbours into
 * the largest same-coloured rectangles. Quads wind counter-clockwise seen
 * from outside. `colorOf` may recolour a face by its direction (e.g. darker
 * undersides); it receives the voxel colour and the face normal.
 */
export function meshVoxels(g: VoxelGrid, colorOf?: (c: number, nx: number, ny: number, nz: number) => number): MeshData {
  const dims = [g.sx, g.sy, g.sz];
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const x = [0, 0, 0];
  const q = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = q[1] = q[2] = 0;
    q[d] = 1;
    const mask = new Uint32Array(dims[u] * dims[v]);
    const side = new Int8Array(dims[u] * dims[v]);
    for (x[d] = -1; x[d] < dims[d]; ) {
      // faces on the plane between slice x[d] and x[d] + 1
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++, n++) {
          const a = x[d] >= 0 ? g.get(x[0], x[1], x[2]) : 0;
          const b = x[d] < dims[d] - 1 ? g.get(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0;
          if (!a === !b) {
            mask[n] = 0;
            side[n] = 0;
          } else if (a) {
            mask[n] = a;
            side[n] = 1;
          } else {
            mask[n] = b;
            side[n] = -1;
          }
        }
      }
      x[d]++;
      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; ) {
          const c = mask[n];
          const sd = side[n];
          if (!c) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < dims[u] && mask[n + w] === c && side[n + w] === sd) w++;
          let h = 1;
          grow: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) {
              const m = n + k + h * dims[u];
              if (mask[m] !== c || side[m] !== sd) break grow;
            }
          }
          x[u] = i;
          x[v] = j;
          const du = [0, 0, 0];
          const dv = [0, 0, 0];
          du[u] = w;
          dv[v] = h;
          const nx = d === 0 ? sd : 0;
          const ny = d === 1 ? sd : 0;
          const nz = d === 2 ? sd : 0;
          const cc = colorOf ? colorOf(c, nx, ny, nz) : c;
          const r = (cc & 0xff) / 255;
          const gg = ((cc >>> 8) & 0xff) / 255;
          const bb = ((cc >>> 16) & 0xff) / 255;
          const base = pos.length / 3;
          pos.push(x[0], x[1], x[2]);
          pos.push(x[0] + du[0], x[1] + du[1], x[2] + du[2]);
          pos.push(x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]);
          pos.push(x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]);
          for (let k = 0; k < 4; k++) {
            nrm.push(nx, ny, nz);
            col.push(r, gg, bb);
          }
          // u x v points along +d, so this order faces +d; flip it for -d
          if (sd > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;
          i += w;
          n += w;
        }
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    indices: new Uint32Array(idx),
  };
}

/**
 * Half-resolution copy for distant models (place it at scale 2): each 2x2x2
 * block becomes one voxel, filled when at least 3 of its 8 cells are, with
 * the block's commonest colour.
 */
export function halfVoxels(g: VoxelGrid): VoxelGrid {
  const out = new VoxelGrid(Math.ceil(g.sx / 2), Math.ceil(g.sy / 2), Math.ceil(g.sz / 2));
  const counts = new Map<number, number>();
  for (let z = 0; z < out.sz; z++) {
    for (let y = 0; y < out.sy; y++) {
      for (let x = 0; x < out.sx; x++) {
        counts.clear();
        let filled = 0;
        for (let k = 0; k < 8; k++) {
          const c = g.get(x * 2 + (k & 1), y * 2 + ((k >> 1) & 1), z * 2 + (k >> 2));
          if (!c) continue;
          filled++;
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        if (filled < 3) continue;
        let best = 0;
        let colour = 0;
        for (const [c, n] of counts) {
          if (n > best) {
            best = n;
            colour = c;
          }
        }
        out.set(x, y, z, colour);
      }
    }
  }
  return out;
}
