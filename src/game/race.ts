// The race itself: who is on the grid, laps, positions, walls, boost pads.
// Pure logic: the RaceScene feeds it controls and draws the result.
import { CAR_DESIGNS, type CarDesign } from '../art/cars.ts';
import { CURB_WIDTH, gradeAt, heightAt, newProbe, pointAt, probe, probeNear, startGrid, wrapS, type Probe, type TrackGeometry, type TrackPoint } from '../tracks/geometry.ts';
import { THEMES, type Surface, type Theme } from '../tracks/themes.ts';
import { AIDriver } from './ai.ts';
import { ITEM_KINDS, Items, type ItemKind } from './items.ts';
import { RULES, type Difficulty, type DifficultyRules } from './difficulty.ts';
import {
  GRAVITY,
  collideCars,
  forwardSpeed,
  newBody,
  specFromStats,
  stepCar,
  wrapAngle,
  type CarBody,
  type CarSpec,
  type Controls,
} from './physics.ts';

export type SurfaceKind = 'road' | 'curb' | 'offroad';

export interface Racer {
  index: number;
  name: string;
  design: CarDesign;
  alt: boolean;
  isPlayer: boolean;
  spec: CarSpec;
  body: CarBody;
  ai: AIDriver;
  controls: Controls;
  probe: Probe;
  /** Nearest centreline sample, tracked continuously. */
  seg: number;
  /** Distance travelled along the track, in samples (laps x n + seg). */
  progress: number;
  lapsDone: number;
  lapStart: number;
  lapTimes: number[];
  bestLap: number;
  finished: boolean;
  finishTime: number;
  place: number;
  surface: SurfaceKind;
  /** Seconds spent driving the wrong way. */
  wrongWay: number;
  padCooldown: number;
  /** Drift points not banked yet: lost on a crash, banked a moment after the last drift of a combo. */
  driftPoints: number;
  /** Combo multiplier of the current drift chain (0 when there is none). */
  driftCombo: number;
  /** Seconds since the last drift ended. */
  driftGap: number;
  /** Gold coins carried (see items.ts); each adds to top speed. */
  coins: number;
  /** Items in hand: a missile and a shield at most, each in its own slot. */
  held: Record<ItemKind, boolean>;
  /** Seconds of shield left. */
  shield: number;
  /** Seconds a missile can't knock this car out (after being hit). */
  immune: number;
  /** In a mud or oil puddle right now. */
  inPuddle: boolean;
  /** Which item buttons were down last step (each item goes off once per press). */
  pressed: Record<ItemKind, boolean>;
  /** Height of the road under the car, px (the deck's, on a bridge), and what it was a step ago. */
  ground: number;
  groundBefore: number;
  /** On a bridge deck (the overhead view draws the car above the deck). */
  onDeck: boolean;
}

export type RaceEvent =
  | { type: 'wall'; racer: Racer; impact: number; x: number; y: number }
  | { type: 'bump'; a: Racer; b: Racer; impact: number; x: number; y: number }
  | { type: 'lap'; racer: Racer; lap: number; time: number }
  | { type: 'finish'; racer: Racer; place: number; time: number }
  | { type: 'boostPad'; racer: Racer }
  | { type: 'driftStart'; racer: Racer; combo: number }
  | { type: 'driftBank'; racer: Racer; points: number }
  | { type: 'driftCrash'; racer: Racer; points: number }
  | { type: 'nitroReady'; racer: Racer }
  | { type: 'nitro'; racer: Racer }
  | { type: 'coin'; racer: Racer; x: number; y: number }
  | { type: 'pickup'; racer: Racer; item: ItemKind; x: number; y: number }
  | { type: 'shieldUp'; racer: Racer }
  | { type: 'missile'; racer: Racer; target: Racer }
  | { type: 'noTarget'; racer: Racer }
  /** A missile reached `racer` (`blocked` by its shield); `lost` coins spilled. */
  | { type: 'boom'; racer: Racer; by: Racer; x: number; y: number; blocked: boolean; lost: number }
  | { type: 'fizzle'; x: number; y: number }
  /** `racer` knocked over an obstacle. */
  | { type: 'knock'; racer: Racer; x: number; y: number; shielded: boolean; lost: number }
  | { type: 'splash'; racer: Racer; x: number; y: number }
  | { type: 'takeoff'; racer: Racer }
  /** Back on the road after `air` seconds; `impact` is how fast it came down, px/s. */
  | { type: 'land'; racer: Racer; air: number; impact: number }
  /** A long enough jump scores points into the nitro gauge. */
  | { type: 'air'; racer: Racer; time: number; points: number };

/** Drift points per second: speed (px/s) x slide angle (degrees) x this, times the combo. */
const DRIFT_POINTS = 0.5;
/** Points that fill the nitro gauge from empty. */
export const NITRO_POINTS = 15000;
/** A drift started within this many seconds of the last one continues the combo. */
export const DRIFT_CHAIN = 2;
const MAX_COMBO = 5;
/** Hits harder than this (closing speed, px/s) wreck a drift combo. */
const CRASH_IMPACT = 60;
/** Share of its speed a car loses hitting a wall square on; glancing hits lose far less (it goes with sin² of the angle). */
const WALL_LOSS = 0.6;
/** Share of the speed into a wall that bounces back off it. */
const WALL_BOUNCE = 0.2;
/** Scraping along a wall slows a car by this much, px/s². */
const WALL_SCRAPE = 150;
/** The slowdown after a wall hit stops at this share of the car's top speed. */
const WALL_FLOOR = 0.35;
/** The longest a wall hit holds a car back, seconds (it ends sooner once the car has slowed down). */
const KNOCK_TIME = 0.8;
/** A reset puts the car back on the road rolling at this share of its top speed. */
const RESET_SPEED = 0.3;
/** ...at a spot with no other car's centre closer than this (px), if it can find one. */
const RESET_ROOM = 30;
/** A car leaves the road when its flight would carry it this far above it in one step, px. */
const TAKEOFF = 0.05;
/** Jumps longer than this (seconds in the air) score points: speed (px/s) x seconds x AIR_POINTS. */
const AIR_SCORE_TIME = 0.3;
const AIR_POINTS = 20;
/** Cars further apart in height than this (one on a bridge, one under it, or one flying over another) don't touch, px. */
const LEVEL_GAP = 10;

// on the road, the speed above top speed when a boost or the nitro runs out comes off quickly
const ROAD: Surface = { speed: 1, grip: 1, accel: 1, scrub: 420 };
const CURB: Surface = { speed: 0.96, grip: 0.95, accel: 1, scrub: 420 };

export const RACERS = 4;

/**
 * The player's car plus the built-in cars as rivals. When the player drives a
 * built-in car, a repainted twin of it fills the last grid slot.
 */
export function buildField(player: CarDesign): { design: CarDesign; alt: boolean; isPlayer: boolean }[] {
  const others = CAR_DESIGNS.filter((d) => d.id !== player.id);
  const field = [{ design: player, alt: false, isPlayer: true }];
  for (const d of others) field.push({ design: d, alt: false, isPlayer: false });
  while (field.length < RACERS) field.push({ design: player, alt: true, isPlayer: false });
  return field.slice(0, RACERS);
}

export class Race {
  readonly geom: TrackGeometry;
  readonly theme: Theme;
  readonly laps: number;
  readonly difficulty: Difficulty;
  readonly rules: DifficultyRules;
  readonly racers: Racer[] = [];
  readonly player: Racer;
  readonly items: Items;
  time = 0;
  started = false;
  events: RaceEvent[] = [];
  private finishedCount = 0;
  private readonly wallProbe = newProbe();

  constructor(geom: TrackGeometry, playerCar: CarDesign, difficulty: Difficulty = 'hard') {
    this.difficulty = difficulty;
    this.rules = RULES[difficulty];
    this.geom = geom;
    this.theme = THEMES[geom.def.theme];
    this.laps = geom.def.laps;
    const field = buildField(playerCar);
    const grid = startGrid(geom, field.length);
    // AI cars take the front slots in a shuffled order, the player starts last
    const aiSlots = field.map((_, i) => i).slice(0, field.length - 1);
    for (let i = aiSlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [aiSlots[i], aiSlots[j]] = [aiSlots[j], aiSlots[i]];
    }
    let ai = 0;
    field.forEach((f, index) => {
      const slot = grid[f.isPlayer ? field.length - 1 : aiSlots[ai++]];
      const w = Math.max(...f.design.top.map((row) => row.length));
      const h = f.design.top.length;
      const body = newBody(slot.x, slot.y, slot.angle, heightAt(geom, slot.s));
      const lane = (index % 2 ? 1 : -1) * geom.halfWidth * (0.15 + 0.12 * index);
      // easier levels slow the rivals down (it scales their straights and their corners)
      const skill = geom.def.aiSkill * (0.96 + Math.random() * 0.05) * (f.isPlayer ? 1 : this.rules.rivalSpeed);
      const racer: Racer = {
        index,
        name: f.alt ? f.design.alt.name : f.design.name,
        design: f.design,
        alt: f.alt,
        isPlayer: f.isPlayer,
        spec: specFromStats(f.design.stats, w, h),
        body,
        ai: new AIDriver(lane, Math.min(1, skill), index * 1.7),
        controls: { throttle: 0, steer: 0, drift: false, nitro: false, missile: false, shield: false },
        probe: newProbe(),
        seg: 0,
        progress: 0,
        lapsDone: 0,
        lapStart: 0,
        lapTimes: [],
        bestLap: Infinity,
        finished: false,
        finishTime: 0,
        place: index + 1,
        surface: 'road',
        wrongWay: 0,
        padCooldown: 0,
        driftPoints: 0,
        driftCombo: 0,
        driftGap: 0,
        coins: 0,
        held: { missile: false, shield: false },
        shield: 0,
        immune: 0,
        inPuddle: false,
        pressed: { missile: false, shield: false },
        ground: body.z,
        groundBefore: body.z,
        onDeck: false,
      };
      probe(geom, body.x, body.y, racer.probe);
      racer.seg = racer.probe.i;
      racer.progress = racer.seg > geom.n / 2 ? racer.seg - geom.n : racer.seg;
      this.racers.push(racer);
    });
    this.player = this.racers.find((r) => r.isPlayer)!;
    this.items = new Items(this);
    this.updatePlaces();
  }

  /** Displayed lap number (1-based) for a racer. */
  lapOf(r: Racer): number {
    return Math.min(this.laps, r.lapsDone + 1);
  }

  /** Gentle catch-up: AI cars far behind the player push a bit harder, far ahead ones relax. */
  rubberBand(r: Racer): number {
    if (r.isPlayer) return 1;
    const gap = (this.player.progress - r.progress) / this.geom.n;
    if (gap > 0) return 1 + Math.min(0.07, gap * 0.25);
    return 1 - Math.min(0.08, -gap * 0.25);
  }

  /**
   * The R reset, for a car that is stuck, off the road or facing the wrong
   * way: back on the road at the point of the lap it has reached, facing the
   * right way and rolling. It lands in the middle of the road, or if another
   * car is there, at the side of it or a car length or two further back. Not
   * before the start, after the finish or while knocked out by a missile
   * (returns false then).
   */
  resetToTrack(r: Racer): boolean {
    if (!this.started || r.finished || r.body.stun > 0) return false;
    const g = this.geom;
    const s = r.seg * g.ds;
    const side = g.halfWidth - r.spec.radius - 2;
    const spots = [0, 24, 48].flatMap((back) => [0, -side, side].map((lane) => pointAt(g, s - back, lane)));
    const room = (p: TrackPoint) => Math.min(...this.racers.filter((o) => o !== r).map((o) => Math.hypot(o.body.x - p.x, o.body.y - p.y)));
    const spot = spots.find((p) => room(p) > RESET_ROOM) ?? spots.reduce((a, p) => (room(p) > room(a) ? p : a));
    const b = r.body;
    const v = RESET_SPEED * r.spec.maxSpeed;
    b.x = spot.x;
    b.y = spot.y;
    b.angle = spot.angle;
    b.vx = spot.tx * v;
    b.vy = spot.ty * v;
    // nothing carries over but the nitro
    b.steer = 0;
    b.boost = 0;
    b.drift = 0;
    b.driftTime = 0;
    b.slip = 0;
    b.knock = 0;
    b.knockYaw = 0;
    b.surge = 0;
    b.air = 0;
    b.vz = 0;
    r.wrongWay = 0;
    this.track(r);
    b.z = r.ground;
    r.groundBefore = r.ground;
    return true;
  }

  step(dt: number, playerControls: Controls): void {
    const g = this.geom;
    if (this.started) this.time += dt;
    for (const r of this.racers) {
      let c: Controls;
      if (!this.started) c = { throttle: 0, steer: 0, drift: false, nitro: false, missile: false, shield: false };
      else if (r.isPlayer && !r.finished) c = playerControls;
      else c = r.ai.drive(this, r, dt);
      r.controls = c;
      // each item has its own button and goes off once per press, but not while knocked out
      for (const kind of ITEM_KINDS) {
        if (c[kind] && !r.pressed[kind] && r.body.stun <= 0) this.items.use(r, kind);
        r.pressed[kind] = c[kind];
      }

      const surf = r.inPuddle ? this.theme.puddle.surface : r.surface === 'road' ? ROAD : r.surface === 'curb' ? CURB : this.theme.offroad;
      // the road's slope where the car is, as height gained per px east and south
      const grade = gradeAt(g, r.probe.s);
      const res = stepCar(r.body, r.spec, c, surf, dt, grade * g.tx[r.seg], grade * g.ty[r.seg]);
      if (res.driftStart) {
        r.driftCombo = r.driftPoints > 0 && r.driftGap < DRIFT_CHAIN ? Math.min(MAX_COMBO, r.driftCombo + 1) : 1;
        this.events.push({ type: 'driftStart', racer: r, combo: r.driftCombo });
      }
      if (res.nitroFired) this.events.push({ type: 'nitro', racer: r });
      this.scoreDrift(r, dt);
      this.walls(r, dt);
    }

    // car-to-car bumps
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i];
        const b = this.racers[j];
        if (Math.abs(a.body.z - b.body.z) > LEVEL_GAP) continue;
        const hit = collideCars(a.body, a.spec, b.body, b.spec);
        if (hit.impact > 25) this.events.push({ type: 'bump', a, b, impact: hit.impact, x: hit.x, y: hit.y });
        if (hit.impact > CRASH_IMPACT) {
          this.crashDrift(a);
          this.crashDrift(b);
        }
      }
    }
    this.items.step(dt);

    for (const r of this.racers) {
      this.track(r);
      this.vertical(r, dt);
      r.padCooldown = Math.max(0, r.padCooldown - dt);
      for (const pad of g.def.boostPads) {
        const ds = wrapS(g, r.probe.s - pad.at * g.length);
        if (r.padCooldown === 0 && Math.abs(ds) < 12 && Math.abs(r.probe.lateral - pad.lateral) < 10) {
          r.body.boost = Math.max(r.body.boost, 0.9);
          r.padCooldown = 0.6;
          this.events.push({ type: 'boostPad', racer: r });
        }
      }
      // wrong way: driving against the track direction for a while
      const along = Math.cos(r.body.angle) * g.tx[r.seg] + Math.sin(r.body.angle) * g.ty[r.seg];
      if (this.started && along < -0.3 && forwardSpeed(r.body) > 25) r.wrongWay += dt;
      else r.wrongWay = Math.max(0, r.wrongWay - dt * 3);
    }
    this.updatePlaces();
  }

  /**
   * Barriers. A car that hits one glances off and runs on along it: the way
   * it was going, or after a square hit, the way its nose leans (stepCar
   * swings the nose round to match). A glancing hit costs little speed and a
   * square one more, part of it at once and the rest over the next moment,
   * and scraping along the wall wears a little more off. That slowdown stops
   * at WALL_FLOOR of top speed, so a crash costs time but never stops you dead.
   */
  private walls(r: Racer, dt: number): void {
    const g = this.geom;
    const b = r.body;
    const p = this.wallProbe;
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);
    const floor = WALL_FLOOR * r.spec.maxSpeed;
    let worst = 0;
    let touching = false;
    let top = b.knock > 0 ? b.knockSpeed : Infinity;
    for (const [off, rad] of [
      [r.spec.halfLength * 0.65, r.spec.radius * 0.7],
      [0, r.spec.radius],
      [-r.spec.halfLength * 0.65, r.spec.radius * 0.7],
    ]) {
      probeNear(g, b.x + cos * off, b.y + sin * off, r.seg, p);
      const limit = g.wallDist - rad;
      if (p.dist <= limit) continue;
      touching = true;
      const pen = p.dist - limit;
      b.x -= p.nx * pen;
      b.y -= p.ny * pen;
      const vn = b.vx * p.nx + b.vy * p.ny;
      if (vn <= 0) continue;
      // (tx, ty) runs along the wall; `along` picks which way the car goes on
      const speed = Math.hypot(b.vx, b.vy);
      const tx = -p.ny;
      const ty = p.nx;
      const vt = b.vx * tx + b.vy * ty;
      let along = Math.sign(vt);
      if (Math.abs(vt) < 0.3 * speed) {
        // a square hit: the way the nose leans (the tail, if reversing), or else the way the race goes
        const lean = (cos * tx + sin * ty) * (b.vx * cos + b.vy * sin);
        along = Math.sign(lean) || (tx * g.tx[r.seg] + ty * g.ty[r.seg] >= 0 ? 1 : -1);
      }
      const keep = 1 - WALL_LOSS * (vn / speed) ** 2;
      // the square root of the share kept comes off now, plus a little bounce
      const bounce = WALL_BOUNCE * vn;
      const slide = along * Math.sqrt(Math.max(0, speed * speed * keep - bounce * bounce));
      b.vx = tx * slide - p.nx * bounce;
      b.vy = ty * slide - p.ny * bounce;
      top = Math.min(top, Math.max(floor, speed * keep));
      if (!b.drift) {
        // the nose (or the tail, if reversing) swings round to the wall's direction; a drift keeps its own angle
        let turn = wrapAngle(Math.atan2(ty * along, tx * along) - b.angle);
        if (Math.abs(turn) > Math.PI / 2) turn = wrapAngle(turn + Math.PI);
        b.knockYaw = turn;
      }
      if (vn > worst) worst = vn;
    }
    if (touching) {
      // the rest of the hit comes off gradually (see stepCar), and scraping wears off a little more
      if (top === Infinity) top = Math.hypot(b.vx, b.vy);
      b.knockSpeed = Math.max(floor, top - WALL_SCRAPE * dt);
      b.knock = KNOCK_TIME;
    }
    if (worst > 30) {
      this.events.push({ type: 'wall', racer: r, impact: worst, x: b.x + p.nx * r.spec.radius, y: b.y + p.ny * r.spec.radius });
    }
    if (worst > CRASH_IMPACT) this.crashDrift(r);
  }

  /**
   * Drift scoring, Need for Speed style: points flow while you slide (faster
   * and wider is worth more), drifts chained close together raise the combo,
   * and the points fill the nitro gauge as they come in.
   */
  private scoreDrift(r: Racer, dt: number): void {
    const b = r.body;
    if (b.drift) {
      r.driftGap = 0;
      // a slide that runs onto the grass or sand scores nothing while it straightens out there
      if (r.surface === 'offroad') return;
      const pts = Math.hypot(b.vx, b.vy) * ((b.slip * 180) / Math.PI) * DRIFT_POINTS * r.driftCombo * dt;
      r.driftPoints += pts;
      if (b.nitroTime <= 0 && b.nitro < 1) {
        const charge = r.isPlayer ? this.rules.playerNitro : this.rules.rivalNitro;
        b.nitro = Math.min(1, b.nitro + (pts * charge) / NITRO_POINTS);
        if (b.nitro >= 1) this.events.push({ type: 'nitroReady', racer: r });
      }
    } else if (r.driftPoints > 0) {
      r.driftGap += dt;
      if (r.driftGap >= DRIFT_CHAIN) {
        this.events.push({ type: 'driftBank', racer: r, points: Math.round(r.driftPoints) });
        r.driftPoints = 0;
        r.driftCombo = 0;
      }
    }
  }

  /** A hard hit ends the drift and loses the combo's points (the nitro already earned stays). */
  crashDrift(r: Racer): void {
    const b = r.body;
    if (!b.drift && r.driftPoints <= 0) return;
    b.drift = 0;
    b.driftTime = 0;
    b.slip = 0;
    if (r.driftPoints > 0) this.events.push({ type: 'driftCrash', racer: r, points: Math.round(r.driftPoints) });
    r.driftPoints = 0;
    r.driftCombo = 0;
  }

  private track(r: Racer): void {
    const g = this.geom;
    probeNear(g, r.body.x, r.body.y, r.seg, r.probe);
    let d = r.probe.i - r.seg;
    if (d > g.n / 2) d -= g.n;
    else if (d < -g.n / 2) d += g.n;
    if (Math.abs(d) < 60) {
      r.progress += d;
      r.seg = r.probe.i;
    }
    const dist = r.probe.dist;
    r.surface = dist < g.halfWidth + 1 ? 'road' : dist < g.halfWidth + CURB_WIDTH ? 'curb' : 'offroad';
    r.onDeck = g.deck[r.probe.i] === 1;
    // a bridge's verges are paved
    if (r.onDeck && r.surface === 'offroad') r.surface = 'curb';
    r.ground = heightAt(g, r.probe.s);

    const laps = Math.floor(r.progress / g.n);
    if (laps > r.lapsDone && !r.finished) {
      r.lapsDone = laps;
      const lapTime = this.time - r.lapStart;
      r.lapTimes.push(lapTime);
      r.bestLap = Math.min(r.bestLap, lapTime);
      r.lapStart = this.time;
      if (laps >= this.laps) {
        r.finished = true;
        r.finishTime = this.time;
        r.place = ++this.finishedCount;
        this.events.push({ type: 'finish', racer: r, place: r.place, time: this.time });
      } else {
        this.events.push({ type: 'lap', racer: r, lap: laps + 1, time: lapTime });
      }
    }
  }

  /**
   * Height: on the road the car rides the road's profile. Where the road
   * drops away faster than gravity can follow (over a jump's lip, or a sharp
   * crest at speed) the car takes off and flies until it comes down on the
   * road again. Landings never cost speed.
   */
  private vertical(r: Racer, dt: number): void {
    const b = r.body;
    const ground = r.ground;
    // how fast the road under the car rose over this step (measured, so it
    // is right on the inside of a bend too, where the road goes by faster)
    const climb = (ground - r.groundBefore) / dt;
    r.groundBefore = ground;
    if (b.air > 0) {
      b.vz -= GRAVITY * dt;
      b.z += b.vz * dt;
      b.air += dt;
      if (b.z > ground) return;
      const air = b.air;
      const impact = Math.max(0, climb - b.vz);
      b.z = ground;
      b.vz = climb;
      b.air = 0;
      this.events.push({ type: 'land', racer: r, air, impact });
      if (air >= AIR_SCORE_TIME && this.started) this.scoreAir(r, air);
      return;
    }
    // Still rising as it did last step, the car would be this high: when the
    // road has fallen away faster than gravity pulls (2nd difference vs G),
    // it leaves the road and flies.
    const ahead = b.z + b.vz * dt;
    if (ahead - GRAVITY * dt * dt > ground + TAKEOFF && this.started) {
      b.air = dt;
      b.z = ahead - 0.5 * GRAVITY * dt * dt;
      b.vz -= GRAVITY * dt;
      this.events.push({ type: 'takeoff', racer: r });
      return;
    }
    b.z = ground;
    b.vz = climb;
  }

  /** Points for a jump, straight into the nitro gauge (like drift points, with the level's charging rate). */
  private scoreAir(r: Racer, time: number): void {
    const b = r.body;
    const points = Math.round(Math.hypot(b.vx, b.vy) * time * AIR_POINTS);
    if (b.nitroTime <= 0 && b.nitro < 1) {
      const charge = r.isPlayer ? this.rules.playerNitro : this.rules.rivalNitro;
      b.nitro = Math.min(1, b.nitro + (points * charge) / NITRO_POINTS);
      if (b.nitro >= 1) this.events.push({ type: 'nitroReady', racer: r });
    }
    this.events.push({ type: 'air', racer: r, time, points });
  }

  private updatePlaces(): void {
    const running = this.racers.filter((r) => !r.finished).sort((a, b) => b.progress - a.progress);
    running.forEach((r, i) => (r.place = this.finishedCount + i + 1));
  }

  /** Racers ordered by place. */
  standings(): Racer[] {
    return [...this.racers].sort((a, b) => a.place - b.place);
  }

  /** Finish time for a racer that has not crossed the line yet, from its average pace. */
  projectedTime(r: Racer): number {
    if (r.finished) return r.finishTime;
    const total = this.laps * this.geom.n;
    const done = Math.max(1, r.progress);
    const pace = this.time / done;
    return this.time + Math.max(0, total - r.progress) * pace;
  }

  allFinished(): boolean {
    return this.racers.every((r) => r.finished);
  }
}
