// Sanity checks for a track's layout, printed by `npm run sim`: where the
// loop crosses itself one side must be on a bridge with room underneath,
// nothing may sit on a bridge or a jump's ramp, a river may only meet the
// road under a bridge, and a jump needs a straight run to land on. Pure
// code, so Node can run it.
import { WALL_THICKNESS, heightAt, pointAt, wrapS, type TrackGeometry } from './geometry.ts';
import { riverField } from './terrain.ts';

/** Least room between a bridge's road and a road passing under it, px (the slab takes 6). */
const MIN_CLEARANCE = 30;
/**
 * A car flies straight off a jump, so for this far past the lip (px) the
 * road may bend away from that line by no more than this share of its half-width.
 */
const LANDING_RUN = 180;
const LANDING_DRIFT = 0.55;

/** Problems with a track's layout, as sentences (none for a good track). Needs the geometry's field. */
export function checkTrack(g: TrackGeometry): string[] {
  const found = new Set<string>();
  const out = { push: (msg: string) => found.add(msg) };
  const def = g.def;
  const n = g.n;
  const L = g.length;
  const at = (s: number) => (((s % L) + L) % L / L).toFixed(3);
  const band = g.wallDist + WALL_THICKNESS;

  // where the centreline crosses itself
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.min(j - i, n - (j - i)) * g.ds < 4 * band) continue;
      const i2 = (i + 1) % n;
      const j2 = (j + 1) % n;
      const ex = g.x[i2] - g.x[i];
      const ey = g.y[i2] - g.y[i];
      const fx = g.x[j2] - g.x[j];
      const fy = g.y[j2] - g.y[j];
      const den = ex * fy - ey * fx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = g.x[j] - g.x[i];
      const qy = g.y[j] - g.y[i];
      const u = (qx * fy - qy * fx) / den;
      const v = (qx * ey - qy * ex) / den;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const si = (i + u) * g.ds;
      const sj = (j + v) * g.ds;
      const top = heightAt(g, si) >= heightAt(g, sj) ? i : j;
      const sTop = top === i ? si : sj;
      const sLow = top === i ? sj : si;
      if (!g.deck[top]) {
        out.push(`the road crosses itself at ${at(si)} and ${at(sj)}, but neither side is on a bridge (add one to "bridges")`);
        continue;
      }
      const room = heightAt(g, sTop) - heightAt(g, sLow);
      if (room < MIN_CLEARANCE) out.push(`the bridge at ${at(sTop)} is only ${room.toFixed(0)} px above the road under it at ${at(sLow)} (needs ${MIN_CLEARANCE})`);
      // the deck has to reach past the road below on both sides
      const sin = Math.abs(den) / (Math.hypot(ex, ey) * Math.hypot(fx, fy));
      const need = band / Math.max(0.3, sin) + 6;
      for (const d of [-need, need]) {
        if (!g.deck[Math.floor((((sTop + d) % L) + L) % L / g.ds) % n]) out.push(`the bridge at ${at(sTop)} ends too close to the road under it (it should run ${Math.ceil(need)} px either side)`);
      }
    }
  }

  // nothing on a bridge or a jump's ramp
  const ramps = def.jumps.map((jp) => ({ from: jp.at * L - jp.up - 20, to: jp.at * L + jp.down + 20 }));
  const spots: [string, number][] = [
    ...def.boostPads.map((p): [string, number] => ['boost pad', p.at * L]),
    ...def.coins.flatMap((c) => Array.from({ length: c.count }, (_, k): [string, number] => ['coin', c.at * L + k * 14])),
    ...def.itemRows.map((s): [string, number] => ['item row', s * L]),
    ...def.obstacles.map((o): [string, number] => ['obstacle', o.at * L]),
    ...def.puddles.map((q): [string, number] => ['puddle', q.at * L]),
  ];
  for (const [what, s] of spots) {
    const i = Math.floor((((s % L) + L) % L) / g.ds) % n;
    if (g.deck[i]) out.push(`a ${what} at ${at(s)} is on a bridge`);
    else if (ramps.some((r) => wrapS(g, s - r.from) >= 0 && wrapS(g, r.to - s) >= 0)) out.push(`a ${what} at ${at(s)} is on a jump's ramp`);
  }

  // a jump needs a straight run to land on
  for (const jp of def.jumps) {
    const lip = pointAt(g, jp.at * L);
    for (let d = g.ds; d <= LANDING_RUN; d += g.ds) {
      const p = pointAt(g, jp.at * L + d);
      const off = Math.abs((p.x - lip.x) * -lip.ty + (p.y - lip.y) * lip.tx);
      if (off > g.halfWidth * LANDING_DRIFT) {
        out.push(`the jump at ${jp.at} lands in a bend (the road turns ${Math.round(off)} px off the line of flight ${Math.round(d)} px past the lip)`);
        break;
      }
    }
  }

  // a river only meets the road under a bridge
  if (def.river && g.seg.length) {
    const field = riverField(def.river, g.width, g.height);
    const wet = def.river.width / 2 + 4;
    let bad = -1;
    for (let o = 0; o < field.length && bad < 0; o += 3) if (field[o] < wet && g.seg[o] >= 0 && g.dist2[o] < band * band) bad = g.seg[o];
    if (bad >= 0) out.push(`the river runs across the road at ${at(bad * g.ds)} where there is no bridge`);
  }
  return [...found];
}
