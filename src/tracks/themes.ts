// Look and feel of each environment: colours, barrier style and how the
// off-road surface behaves.
import type { ThemeId } from './tracks.ts';

export interface Surface {
  /** Multiplier on top speed. */
  speed: number;
  /** Multiplier on sideways grip (lower = slides more). */
  grip: number;
  /** Multiplier on acceleration. */
  accel: number;
  /** How fast a car arriving faster than this surface's top speed slows down to it, px/s². */
  scrub: number;
}

export type ObstacleKind = 'bale' | 'keg' | 'cone';

export interface Theme {
  id: ThemeId;
  label: string;
  night: boolean;
  ground: { base: string; patch: string; dark: string; light: string };
  runoff: { a: string; b: string; edge: string };
  road: { base: string; dark: string; light: string; line: string; centre: string | null };
  curb: [string, string];
  wall: 'tires' | 'rocks' | 'barrier';
  /** Off-road physics. */
  offroad: Surface;
  /** What stands on the road to be knocked over (see items.ts). */
  obstacle: ObstacleKind;
  /** Slippery patches on the road: mud or oil, how they drive, and their colours (main, rim, shine). */
  puddle: { name: 'mud' | 'oil'; surface: Surface; colors: [string, string, string] };
  /** Particle colour kicked up off-road (0xRRGGBB). */
  dust: number;
  /** Colour of tyre marks. */
  skid: number;
  /** Background colour around the world. */
  backdrop: number;
  /** Minimap colours. */
  map: { bg: number; road: number };
}

export const THEMES: Record<ThemeId, Theme> = {
  meadow: {
    id: 'meadow',
    label: 'Meadow',
    night: false,
    ground: { base: '#5ab552', patch: '#4fa84a', dark: '#3d8a3f', light: '#7cd468' },
    runoff: { a: '#7ccf68', b: '#6dc25c', edge: '#4a9a45' },
    road: { base: '#5b5e6e', dark: '#4f5262', light: '#696d80', line: '#f4f4f4', centre: null },
    curb: ['#e43b44', '#f4f4f4'],
    wall: 'tires',
    offroad: { speed: 0.75, grip: 0.85, accel: 0.85, scrub: 150 },
    obstacle: 'bale',
    // mud is sticky: slower, and only a little slippery
    puddle: { name: 'mud', surface: { speed: 0.72, grip: 0.55, accel: 0.7, scrub: 170 }, colors: ['#7a5232', '#5d3b24', '#a0683f'] },
    dust: 0x3d8a3f,
    skid: 0x2e303c,
    backdrop: 0x4fa84a,
    map: { bg: 0x38b764, road: 0xf4f4f4 },
  },
  canyon: {
    id: 'canyon',
    label: 'Canyon',
    night: false,
    ground: { base: '#e9c27a', patch: '#e0b56c', dark: '#c99a55', light: '#f6d899' },
    runoff: { a: '#d9a463', b: '#d29c5b', edge: '#b9834a' },
    road: { base: '#857a74', dark: '#796e69', light: '#968a83', line: '#f4f4f4', centre: '#ffcd75' },
    curb: ['#ef7d57', '#f4f4f4'],
    wall: 'rocks',
    offroad: { speed: 0.7, grip: 0.55, accel: 0.8, scrub: 170 },
    obstacle: 'keg',
    // oil is slippery: the tyres hardly grip, but it barely slows you
    puddle: { name: 'oil', surface: { speed: 0.9, grip: 0.18, accel: 0.75, scrub: 150 }, colors: ['#2a2433', '#15121b', '#7d6a9e'] },
    dust: 0xd9b072,
    skid: 0x4e4440,
    backdrop: 0xe0b56c,
    map: { bg: 0xc99a55, road: 0xfff3a0 },
  },
  city: {
    id: 'city',
    label: 'City',
    night: true,
    ground: { base: '#232740', patch: '#262b46', dark: '#1b1e33', light: '#30365a' },
    runoff: { a: '#4f5476', b: '#4a4f70', edge: '#3a3e5c' },
    road: { base: '#2f3349', dark: '#292c40', light: '#3a3f58', line: '#c8cde0', centre: '#c8cde0' },
    curb: ['#ff4fd8', '#41e6ff'],
    wall: 'barrier',
    offroad: { speed: 0.85, grip: 0.95, accel: 0.9, scrub: 140 },
    obstacle: 'cone',
    puddle: { name: 'oil', surface: { speed: 0.9, grip: 0.18, accel: 0.75, scrub: 150 }, colors: ['#151622', '#0b0c14', '#41e6ff'] },
    dust: 0x8a8fb0,
    skid: 0x15161f,
    backdrop: 0x1b1e33,
    map: { bg: 0x29366f, road: 0x73eff7 },
  },
};
