// Bridges the pure Raster art into Phaser textures.
import Phaser from 'phaser';
import { Raster, hex, shade } from '../art/raster.ts';
import { buildFontAtlas, FONT_LINE_HEIGHT } from '../art/font.ts';
import { CAR_DIRECTIONS, buildCarSheet, buildIcons, buildPortrait, coneRaster } from '../art/sprites.ts';
import { bubbleIcon, coinFrames, obstacleSprite, rocketIcon, rocketSheet, shieldRing } from '../art/itemArt.ts';
import type { CarDesign } from '../art/cars.ts';
import { allCars, isCustom } from '../game/customCars.ts';
import { FONT } from '../config.ts';
import { rasterToCanvas } from './canvas.ts';

export function addRaster(scene: Phaser.Scene, key: string, r: Raster): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.addCanvas(key, rasterToCanvas(r))!;
}

export function carKey(design: CarDesign | string, alt: boolean): string {
  const id = typeof design === 'string' ? design : design.id;
  return `car-${id}${alt ? '-alt' : ''}`;
}

export function portraitKey(design: CarDesign | string, alt: boolean, blink = false): string {
  const id = typeof design === 'string' ? design : design.id;
  return `face-${id}${alt ? '-alt' : ''}${blink ? '-blink' : ''}`;
}

/** Frame name inside a car sheet. look: 0 ahead, 1 left, 2 right. */
export function carFrame(dir: number, look: number): number {
  return look * CAR_DIRECTIONS + dir;
}

function registerFont(scene: Phaser.Scene): void {
  const atlas = buildFontAtlas();
  addRaster(scene, 'font', atlas.raster);
  const tw = atlas.raster.w;
  const th = atlas.raster.h;
  const chars: Record<number, unknown> = {};
  for (const [ch, g] of atlas.glyphs) {
    const glyph = {
      x: g.x,
      y: g.y,
      width: g.w,
      height: g.h,
      centerX: Math.floor(g.w / 2),
      centerY: Math.floor(g.h / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: g.w + 1,
      data: {},
      kerning: {},
      u0: g.x / tw,
      v0: 1 - g.y / th,
      u1: (g.x + g.w) / tw,
      v1: 1 - (g.y + g.h) / th,
    };
    chars[ch.charCodeAt(0)] = glyph;
    const lower = ch.toLowerCase();
    if (lower !== ch) chars[lower.charCodeAt(0)] = glyph;
  }
  const data = { font: FONT, size: 7, lineHeight: FONT_LINE_HEIGHT, retroFont: true, chars };
  scene.cache.bitmapFont.add(FONT, { data, texture: 'font', frame: null });
}

/** Builds the race sheet and portraits for one car (custom cars have no rival paint). */
export function registerCar(scene: Phaser.Scene, design: CarDesign): void {
  for (const alt of isCustom(design.id) ? [false] : [false, true]) {
    const sheet = buildCarSheet(design, alt);
    const tex = addRaster(scene, carKey(design, alt), sheet.raster);
    for (let look = 0; look < 3; look++) {
      for (let d = 0; d < CAR_DIRECTIONS; d++) {
        tex.add(carFrame(d, look), 0, d * sheet.frame, look * sheet.frame, sheet.frame, sheet.frame);
      }
    }
    addRaster(scene, `${carKey(design, alt)}-plain`, sheet.plain);
    const face = buildPortrait(design, alt);
    addRaster(scene, portraitKey(design, alt), face.open);
    addRaster(scene, portraitKey(design, alt, true), face.blink);
  }
}

export function unregisterCar(scene: Phaser.Scene, id: string): void {
  for (const alt of [false, true]) {
    for (const key of [carKey(id, alt), `${carKey(id, alt)}-plain`, portraitKey(id, alt), portraitKey(id, alt, true)]) {
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
  }
}

function registerCars(scene: Phaser.Scene): void {
  for (const design of allCars()) {
    try {
      registerCar(scene, design);
    } catch (err) {
      // a broken saved car must not stop the game from starting
      console.warn(`Skipping car "${design.name}":`, err);
    }
  }
}

function registerBits(scene: Phaser.Scene): void {
  const white = hex('#ffffff');
  addRaster(scene, 'px', new Raster(1, 1).fill(white));
  addRaster(scene, 'dot', new Raster(2, 2).fill(white));
  const puff = new Raster(4, 4).fill(white);
  for (const [x, y] of [[0, 0], [3, 0], [0, 3], [3, 3]]) puff.set(x, y, 0);
  addRaster(scene, 'puff', puff);
  // soft dithered disc for lamp glows and headlights
  const glow = new Raster(32, 32);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
      if (d < 1 && (1 - d) * (1 - d) * 16 > bayer[(y & 3) * 4 + (x & 3)]) glow.set(x, y, white);
    }
  }
  addRaster(scene, 'glow', glow);
  addRaster(scene, 'cone', coneRaster());
  for (const [name, r] of buildIcons()) addRaster(scene, `icon-${name}`, r);
  registerItems(scene);
}

/** Headings in the missile sheet ('item-missile'), frame d pointing at d * 2pi / MISSILE_DIRECTIONS - pi/2. */
export const MISSILE_DIRECTIONS = 16;

/** Race item pictures (see art/itemArt.ts): coin frames, pickups, missiles, the shield ring, obstacles. */
function registerItems(scene: Phaser.Scene): void {
  const coins = coinFrames();
  const cw = coins[0].w;
  const sheet = new Raster(cw * coins.length, coins[0].h);
  coins.forEach((c, i) => sheet.blit(c, i * cw, 0));
  const coinTex = addRaster(scene, 'item-coin', sheet);
  coins.forEach((_, i) => coinTex.add(i, 0, i * cw, 0, cw, sheet.h));
  addRaster(scene, 'item-rocket', rocketIcon());
  addRaster(scene, 'item-bubble', bubbleIcon());
  addRaster(scene, 'item-shield', shieldRing());
  const missiles = rocketSheet(MISSILE_DIRECTIONS);
  const mTex = addRaster(scene, 'item-missile', missiles.raster);
  for (let d = 0; d < MISSILE_DIRECTIONS; d++) mTex.add(d, 0, d * missiles.frame, 0, missiles.frame, missiles.frame);
  for (const kind of ['bale', 'keg', 'cone'] as const) addRaster(scene, `ob-${kind}`, obstacleSprite(kind));
}

/** Rounded pixel panel texture, generated on demand and cached by size + colours. */
export function panelKey(scene: Phaser.Scene, w: number, h: number, fill: number, border = 0x1a1c2c, light?: number): string {
  const key = `panel-${w}x${h}-${fill.toString(16)}-${border.toString(16)}-${light ?? 'x'}`;
  if (scene.textures.exists(key)) return key;
  const toC = (c: number) => hex('#' + c.toString(16).padStart(6, '0'));
  const r = new Raster(w, h);
  const f = toC(fill);
  const b = toC(border);
  const hi = light !== undefined ? toC(light) : shade(f, 0.25);
  const lo = shade(f, -0.2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(x, w - 1 - x);
      const cy = Math.min(y, h - 1 - y);
      if (cx + cy < 2) continue; // rounded corners
      const edge = cx === 0 || cy === 0 || cx + cy === 2;
      let c = edge ? b : f;
      if (!edge && y === 1) c = hi;
      else if (!edge && (y === h - 2 || (cx + cy === 3 && y > h / 2))) c = lo;
      r.set(x, y, c);
    }
  }
  addRaster(scene, key, r);
  return key;
}

export function buildAllTextures(scene: Phaser.Scene): void {
  registerFont(scene);
  registerCars(scene);
  registerBits(scene);
}
