// Difficulty levels. Hard is the game as tuned for skilled players; Easy and
// Medium make the rival cars slower (and slower to earn nitro), charge your
// nitro faster from drifting, and make rivals slower to fire their missiles
// and less keen to aim them at you (on Easy, never). Pure data, shared by the
// race and menus.

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export interface DifficultyRules {
  label: string;
  /** One line for the menu. */
  blurb: string;
  /** Multiplies the rivals' driving skill: how fast they dare to go on straights and through corners. */
  rivalSpeed: number;
  /** Multiplies how fast the rivals' nitro charges from their drifts. */
  rivalNitro: number;
  /** Multiplies how fast your nitro charges from your drifts. */
  playerNitro: number;
  /** How keen rivals are to aim their missiles at you, 0..1 (0 = never; 1 = like any other car). */
  rivalAimAtYou: number;
  /** How long a rival holds a missile before firing it, seconds (shortest, longest). */
  rivalMissileWait: [number, number];
}

export const RULES: Record<Difficulty, DifficultyRules> = {
  easy: { label: 'EASY', blurb: 'SLOWER RIVALS THAT NEVER FIRE AT YOU, 2X NITRO', rivalSpeed: 0.86, rivalNitro: 0.5, playerNitro: 2, rivalAimAtYou: 0, rivalMissileWait: [2, 5] },
  // a third as keen as at other cars: on the two-minute races that is about as often per minute as half was on the first, shorter tracks
  medium: { label: 'MEDIUM', blurb: 'RIVALS A BIT SLOWER, FEWER MISSILES, 1.5X NITRO', rivalSpeed: 0.93, rivalNitro: 0.75, playerNitro: 1.5, rivalAimAtYou: 0.3, rivalMissileWait: [2.5, 6] },
  hard: { label: 'HARD', blurb: 'FULL-SPEED RIVALS, NORMAL NITRO', rivalSpeed: 1, rivalNitro: 1, playerNitro: 1, rivalAimAtYou: 1, rivalMissileWait: [0.8, 2.5] },
};
