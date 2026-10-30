// Cars painted in the in-game paint shop. They are stored in this browser's
// localStorage and appear next to the built-in cars from src/art/cars.ts.
import { BASE_PALETTE, CAR_DESIGNS, type CarDesign, type CarStats } from '../art/cars.ts';
import type { Palette } from '../art/raster.ts';

const KEY = 'tiny-turbo-gp.cars.v1';
export const MAX_CUSTOM_CARS = 12;
/** Speed + accel + handling + weight must add up to at most this. */
export const STAT_BUDGET = 14;
export const MAX_NAME = 10;
/** Letters that belong to a car's own palette (the rest come from BASE_PALETTE). */
export const CAR_LETTERS = ['B', 'h', 'b', 'a', 'A', 'n', 'i'];

interface StoredCar {
  id: string;
  name: string;
  stats: CarStats;
  palette: Palette;
  top: string[];
  front: string[];
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

function rowsOk(rows: unknown, palette: Palette): rows is string[] {
  if (!Array.isArray(rows) || rows.length < 4 || rows.length > 48) return false;
  const w = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (w < 4 || w > 48) return false;
  return rows.every(
    (r) => typeof r === 'string' && r.length === w && [...r].every((ch) => ch === '.' || ch in BASE_PALETTE || ch in palette),
  );
}

function statsOk(s: unknown): s is CarStats {
  if (!s || typeof s !== 'object') return false;
  const st = s as Record<string, unknown>;
  const keys = ['speed', 'accel', 'handling', 'weight'];
  return keys.every((k) => Number.isInteger(st[k]) && (st[k] as number) >= 1 && (st[k] as number) <= 5);
}

function valid(c: unknown): c is StoredCar {
  if (!c || typeof c !== 'object') return false;
  const car = c as Record<string, unknown>;
  if (typeof car.id !== 'string' || !car.id.startsWith('my-') || typeof car.name !== 'string') return false;
  if (!car.palette || typeof car.palette !== 'object') return false;
  const palette = car.palette as Palette;
  if (!Object.values(palette).every((v) => typeof v === 'string' && COLOR.test(v))) return false;
  return statsOk(car.stats) && rowsOk(car.top, palette) && rowsOk(car.front, palette);
}

function read(): StoredCar[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

function write(list: StoredCar[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function toDesign(c: StoredCar): CarDesign {
  return {
    id: c.id,
    name: c.name,
    tagline: 'Painted in your paint shop',
    stats: { ...c.stats },
    palette: { ...c.palette },
    alt: { name: c.name, palette: {} },
    top: [...c.top],
    front: [...c.front],
  };
}

export function customCars(): CarDesign[] {
  return read().map(toDesign);
}

/** Built-in cars first, then the player's own. */
export function allCars(): CarDesign[] {
  return [...CAR_DESIGNS, ...customCars()];
}

export function findCar(id: string): CarDesign | undefined {
  return allCars().find((d) => d.id === id);
}

export function isCustom(id: string): boolean {
  return id.startsWith('my-');
}

export function newCarId(): string {
  return `my-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Saves (or replaces) a custom car. Returns false when the browser refuses to store it. */
export function saveCustomCar(d: CarDesign): boolean {
  const list = read();
  const stored: StoredCar = { id: d.id, name: d.name, stats: { ...d.stats }, palette: { ...d.palette }, top: [...d.top], front: [...d.front] };
  if (!valid(stored)) return false;
  const i = list.findIndex((c) => c.id === d.id);
  if (i >= 0) list[i] = stored;
  else list.push(stored);
  return write(list);
}

export function deleteCustomCar(id: string): void {
  write(read().filter((c) => c.id !== id));
}

/** The car as a ready-to-paste entry for CAR_DESIGNS in src/art/cars.ts. */
export function designToCode(d: CarDesign): string {
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const pal = Object.entries(d.palette).filter(([k, v]) => CAR_LETTERS.includes(k) || BASE_PALETTE[k] !== v);
  const palText = `{ ${pal.map(([k, v]) => `${k}: ${q(v)}`).join(', ')} }`;
  const id = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-car';
  const rows = (r: string[]) => r.map((row) => `      ${q(row)},`).join('\n');
  const s = d.stats;
  return [
    '  {',
    `    id: ${q(id)},`,
    `    name: ${q(d.name)},`,
    `    tagline: ${q('Designed in the paint shop')},`,
    `    stats: { speed: ${s.speed}, accel: ${s.accel}, handling: ${s.handling}, weight: ${s.weight} },`,
    `    palette: ${palText},`,
    `    alt: { name: ${q(d.name + ' II')}, palette: {} },`,
    '    top: [',
    rows(d.top),
    '    ],',
    '    front: [',
    rows(d.front),
    '    ],',
    '  },',
  ].join('\n');
}
