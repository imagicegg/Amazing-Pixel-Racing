/** Internal resolution. The canvas is scaled up to fit the window, pixel-perfect. */
export const GAME_W = 480;
export const GAME_H = 270;

/** Fixed physics step. */
export const PHYSICS_DT = 1 / 120;

export const FONT = 'pixel';

/** UI colours (0xRRGGBB), from the Sweetie 16 palette family. */
export const UI = {
  ink: 0x1a1c2c,
  night: 0x29366f,
  plum: 0x5d275d,
  white: 0xf4f4f4,
  grey: 0x94b0c2,
  slate: 0x566c86,
  yellow: 0xffcd75,
  orange: 0xef7d57,
  red: 0xe43b44,
  pink: 0xf47e9b,
  green: 0x38b764,
  lime: 0xa7f070,
  blue: 0x3b5dc9,
  sky: 0x41a6f6,
  cyan: 0x73eff7,
};

export function formatTime(t: number): string {
  if (!isFinite(t)) return '-:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export function ordinal(n: number): string {
  return `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;
}
