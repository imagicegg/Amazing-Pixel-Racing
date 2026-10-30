import type { Raster } from '../art/raster.ts';

/** Copies a raster into a new canvas element (no Phaser needed). */
export function rasterToCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.bytes()), r.w, r.h), 0, 0);
  return c;
}
