// Best times and settings, kept in this browser's localStorage.
import { DIFFICULTIES, type Difficulty } from './difficulty.ts';

const KEY = 'tiny-turbo-gp.v1';

interface Record {
  time: number;
  car: string;
}

/** 'top': fixed overhead camera. 'chase': the camera turns with your car. */
export type ViewMode = 'top' | 'chase';

interface SaveData {
  /** Best times by track and difficulty (see recordKey). */
  race: { [key: string]: Record };
  lap: { [key: string]: Record };
  muted: boolean;
  car: string;
  track: string;
  view: ViewMode;
  difficulty: Difficulty;
}

function load(): SaveData {
  const empty: SaveData = { race: {}, lap: {}, muted: false, car: '', track: '', view: 'top', difficulty: 'medium' };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

function store(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // private mode or storage full: records just won't persist
  }
}

/**
 * The tracks' layouts: records set on an older layout (the first, smaller
 * tracks) are kept in storage but no longer shown or compared.
 */
const LAYOUT = 2;

/** Records are kept per layout and per difficulty, since easier levels give more nitro. */
function recordKey(trackId: string, difficulty: Difficulty): string {
  return `${trackId}.v${LAYOUT}@${difficulty}`;
}

export function bestRace(trackId: string, difficulty: Difficulty): Record | undefined {
  return load().race[recordKey(trackId, difficulty)];
}

export function bestLap(trackId: string, difficulty: Difficulty): Record | undefined {
  return load().lap[recordKey(trackId, difficulty)];
}

/** Stores a finished race; reports which records were beaten. */
export function submitResult(trackId: string, difficulty: Difficulty, car: string, raceTime: number, lapTime: number): { race: boolean; lap: boolean } {
  const d = load();
  const key = recordKey(trackId, difficulty);
  const race = !d.race[key] || raceTime < d.race[key].time;
  const lap = isFinite(lapTime) && (!d.lap[key] || lapTime < d.lap[key].time);
  if (race) d.race[key] = { time: raceTime, car };
  if (lap) d.lap[key] = { time: lapTime, car };
  store(d);
  return { race, lap };
}

export function getDifficulty(): Difficulty {
  const v = load().difficulty;
  return DIFFICULTIES.includes(v) ? v : 'medium';
}

export function setDifficulty(difficulty: Difficulty): void {
  const d = load();
  d.difficulty = difficulty;
  store(d);
}

export function getMuted(): boolean {
  return load().muted;
}

export function setMuted(m: boolean): void {
  const d = load();
  d.muted = m;
  store(d);
}

export function getView(): ViewMode {
  return load().view === 'chase' ? 'chase' : 'top';
}

export function setView(view: ViewMode): void {
  const d = load();
  d.view = view;
  store(d);
}

export function lastChoice(): { car: string; track: string } {
  const d = load();
  return { car: d.car, track: d.track };
}

export function rememberChoice(car: string, track: string): void {
  const d = load();
  d.car = car;
  d.track = track;
  store(d);
}
