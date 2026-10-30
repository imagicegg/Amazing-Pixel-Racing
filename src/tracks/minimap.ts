// Small pixel-art outline of a track, for menus and the in-race HUD.
import { Raster, hex, shade } from '../art/raster.ts';
import type { TrackGeometry } from './geometry.ts';
import { THEMES } from './themes.ts';

export interface Minimap {
  raster: Raster;
  /** World -> map transform: mx = (x - ox) * scale + pad. */
  scale: number;
  ox: number;
  oy: number;
  pad: number;
}

export function buildMinimap(g: TrackGeometry, maxW: number, maxH: number, thickness = 2): Minimap {
  const th = THEMES[g.def.theme];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < g.n; i++) {
    minX = Math.min(minX, g.x[i]);
    maxX = Math.max(maxX, g.x[i]);
    minY = Math.min(minY, g.y[i]);
    maxY = Math.max(maxY, g.y[i]);
  }
  const pad = thickness + 2;
  const scale = Math.min((maxW - pad * 2) / (maxX - minX), (maxH - pad * 2) / (maxY - minY));
  const w = Math.ceil((maxX - minX) * scale) + pad * 2;
  const h = Math.ceil((maxY - minY) * scale) + pad * 2;
  const road = new Raster(w, h);
  const c = hex('#' + th.map.road.toString(16).padStart(6, '0'));
  for (let i = 0; i < g.n; i++) {
    road.fillCircle((g.x[i] - minX) * scale + pad, (g.y[i] - minY) * scale + pad, thickness, c);
  }
  // start line marker
  const sx = (g.x[0] - minX) * scale + pad;
  const sy = (g.y[0] - minY) * scale + pad;
  road.fillCircle(sx, sy, thickness + 0.6, hex('#1a1c2c'));
  road.fillCircle(sx, sy, thickness - 0.4, hex('#ffcd75'));
  const raster = road.outlined(shade(hex('#' + th.map.bg.toString(16).padStart(6, '0')), -0.55));
  return { raster, scale, ox: minX, oy: minY, pad: pad + 1 };
}
