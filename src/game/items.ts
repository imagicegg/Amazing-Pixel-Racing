// Everything on the track besides the cars: gold coins, item pickups
// (missiles and shields), things to knock over, slippery puddles, and
// missiles in flight. Pure logic like race.ts, which owns one of these and
// steps it after moving the cars; the views draw what they find here.
import { heightAt, pointAt, type TrackGeometry } from '../tracks/geometry.ts';
import type { ObstacleKind } from '../tracks/themes.ts';
import type { Race, Racer } from './race.ts';

export type ItemKind = 'missile' | 'shield';
/** Every kind of item. A car carries one of each at most, in a slot of its own. */
export const ITEM_KINDS: readonly ItemKind[] = ['missile', 'shield'];

/** Most coins a car can carry; each adds this share to its top speed. */
export const MAX_COINS = 10;
export const COIN_SPEED = 0.01;
/** Gap between the coins of a line, px. */
const COIN_SPACING = 14;
/** Seconds until a collected coin, a taken pickup or a knocked-over obstacle is back. */
const COIN_RESPAWN = 6;
const PICKUP_RESPAWN = 2.5;
export const OBSTACLE_RESPAWN = 8;
/** Reach of each thing, px: a car touches it when their centres are closer than this plus the car's radius. */
const COIN_R = 4;
const PICKUP_R = 6;
export const OBSTACLE_R = 6;
/** A missile hit stops a car for this long; after that it can't be knocked out again for IMMUNE_AFTER more. */
export const STUN_TIME = 3;
const IMMUNE_AFTER = 2;
/** Rivals only fire at cars this close ahead along the road (px), so their missiles are seen coming. */
const RIVAL_RANGE = 700;
/** A shield lasts this long, or until it stops a missile. */
export const SHIELD_TIME = 6;
/** Missiles fly at this speed (px/s) and follow the road until they're this close to their target, then home in. */
const MISSILE_SPEED = 560;
const MISSILE_HOMING = 150;
/** A missile that hasn't caught its target by then fizzles out, seconds. */
const MISSILE_LIFE = 8;
/** Coins spilled by a missile hit and by knocking over an obstacle. */
const COINS_LOST_HIT = 3;
const COINS_LOST_BUMP = 1;
/** Knocking over an obstacle costs this share of the car's speed: a third of it at once, the rest over a moment. */
const OBSTACLE_LOSS = 0.3;
const OBSTACLE_KNOCK_TIME = 0.6;
/** A bump faster than this (px/s) wrecks a drift combo, as with walls and cars. */
const CRASH_SPEED = 60;
/** A car touches things within this height of it (so a car under a bridge leaves the deck's coins alone), px. */
const REACH_UP = 14;
/** The pickups across a row: sideways positions in halves of the road, and what each row holds. */
const ROW_LANES = [-0.55, 0, 0.55];
const ROW_KINDS: ItemKind[][] = [
  ['shield', 'missile', 'shield'],
  ['missile', 'shield', 'missile'],
];

export interface Coin {
  x: number;
  y: number;
  /** Height of the road under it. */
  z: number;
  /** Seconds until it is back (0 = there to collect). */
  respawn: number;
}

export interface Pickup {
  x: number;
  y: number;
  z: number;
  kind: ItemKind;
  respawn: number;
}

export interface Obstacle {
  x: number;
  y: number;
  z: number;
  /** Place on the road (arc length and sideways offset), for drivers steering round it. */
  s: number;
  lateral: number;
  /** Seconds until it stands again after being knocked over (0 = standing). */
  respawn: number;
  /** The way it was sent flying, px/s (the views animate it). */
  vx: number;
  vy: number;
}

export interface Puddle {
  x: number;
  y: number;
  z: number;
  s: number;
  lateral: number;
  r: number;
}

export interface Missile {
  owner: Racer;
  target: Racer;
  x: number;
  y: number;
  /** Height above the plain: it flies just over the road, and over its target once homing in. */
  z: number;
  /** Direction of flight. */
  angle: number;
  /** While it follows the road: distance along it (counted like race progress, not wrapped) and sideways offset. */
  s: number;
  lateral: number;
  homing: boolean;
  age: number;
  /** Exploded or fizzled; dropped at the end of the step. */
  done: boolean;
}

const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, r: number, up = REACH_UP) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r && Math.abs(a.z - b.z) < up;

export class Items {
  readonly coins: Coin[] = [];
  readonly pickups: Pickup[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly puddles: Puddle[] = [];
  readonly missiles: Missile[] = [];
  readonly obstacleKind: ObstacleKind;
  private readonly race: Race;

  constructor(race: Race) {
    this.race = race;
    this.obstacleKind = race.theme.obstacle;
    const g: TrackGeometry = race.geom;
    const def = g.def;
    for (const line of def.coins) {
      for (let k = 0; k < line.count; k++) {
        const s = line.at * g.length + k * COIN_SPACING;
        const p = pointAt(g, s, line.lateral);
        this.coins.push({ x: p.x, y: p.y, z: heightAt(g, s), respawn: 0 });
      }
    }
    def.itemRows.forEach((at, row) => {
      ROW_LANES.forEach((lane, k) => {
        const p = pointAt(g, at * g.length, lane * g.halfWidth);
        this.pickups.push({ x: p.x, y: p.y, z: heightAt(g, at * g.length), kind: ROW_KINDS[row % ROW_KINDS.length][k], respawn: 0 });
      });
    });
    for (const o of def.obstacles) {
      const p = pointAt(g, o.at * g.length, o.lateral);
      this.obstacles.push({ x: p.x, y: p.y, z: heightAt(g, o.at * g.length), s: o.at * g.length, lateral: o.lateral, respawn: 0, vx: 0, vy: 0 });
    }
    for (const q of def.puddles) {
      const p = pointAt(g, q.at * g.length, q.lateral);
      this.puddles.push({ x: p.x, y: p.y, z: heightAt(g, q.at * g.length), s: q.at * g.length, lateral: q.lateral, r: q.r });
    }
  }

  step(dt: number): void {
    for (const list of [this.coins, this.pickups, this.obstacles]) {
      for (const it of list) if (it.respawn > 0) it.respawn = Math.max(0, it.respawn - dt);
    }
    for (const r of this.race.racers) {
      r.shield = Math.max(0, r.shield - dt);
      r.immune = Math.max(0, r.immune - dt);
      this.touch(r);
    }
    for (const m of this.missiles) this.fly(m, dt);
    for (let i = this.missiles.length - 1; i >= 0; i--) if (this.missiles[i].done) this.missiles.splice(i, 1);
  }

  /** Coins, pickups, obstacles and puddles under a car. */
  private touch(r: Racer): void {
    const b = r.body;
    const rad = r.spec.radius;
    // the body's height is its wheels'; things are measured from the road
    const at = { x: b.x, y: b.y, z: b.z };
    for (const c of this.coins) {
      if (r.coins >= MAX_COINS) break;
      if (c.respawn > 0 || !near(at, c, rad + COIN_R)) continue;
      c.respawn = COIN_RESPAWN;
      this.setCoins(r, r.coins + 1);
      this.race.events.push({ type: 'coin', racer: r, x: c.x, y: c.y });
    }
    // a car with that kind of item already in hand drives through, leaving it for the others
    for (const p of this.pickups) {
      if (r.held[p.kind] || p.respawn > 0 || !near(at, p, rad + PICKUP_R)) continue;
      p.respawn = PICKUP_RESPAWN;
      r.held[p.kind] = true;
      this.race.events.push({ type: 'pickup', racer: r, item: p.kind, x: p.x, y: p.y });
    }
    for (const o of this.obstacles) {
      if (o.respawn > 0 || !near(at, o, rad + OBSTACLE_R, 10)) continue;
      o.respawn = OBSTACLE_RESPAWN;
      // sent flying ahead of the car, pushed off to the side it was hit on
      const speed = Math.hypot(b.vx, b.vy);
      const away = Math.atan2(o.y - b.y, o.x - b.x);
      o.vx = b.vx * 0.7 + Math.cos(away) * 40;
      o.vy = b.vy * 0.7 + Math.sin(away) * 40;
      let lost = 0;
      if (r.shield <= 0) {
        const keep = 1 - OBSTACLE_LOSS / 3;
        b.vx *= keep;
        b.vy *= keep;
        const slow = speed * (1 - OBSTACLE_LOSS);
        b.knockSpeed = b.knock > 0 ? Math.min(b.knockSpeed, slow) : slow;
        b.knock = Math.max(b.knock, OBSTACLE_KNOCK_TIME);
        lost = this.loseCoins(r, COINS_LOST_BUMP);
        if (speed > CRASH_SPEED) this.race.crashDrift(r);
      }
      this.race.events.push({ type: 'knock', racer: r, x: o.x, y: o.y, shielded: r.shield > 0, lost });
    }
    const was = r.inPuddle;
    // flying over a puddle doesn't count
    r.inPuddle = b.air <= 0 && this.puddles.some((q) => near(at, q, q.r * 0.9, 4));
    if (r.inPuddle && !was && Math.hypot(b.vx, b.vy) > 40) this.race.events.push({ type: 'splash', racer: r, x: b.x, y: b.y });
  }

  private setCoins(r: Racer, n: number): void {
    r.coins = Math.max(0, Math.min(MAX_COINS, n));
    r.body.bonus = r.coins * COIN_SPEED;
  }

  /** Drops up to `n` coins; returns how many were dropped. */
  private loseCoins(r: Racer, n: number): number {
    const lost = Math.min(n, r.coins);
    this.setCoins(r, r.coins - lost);
    return lost;
  }

  /**
   * Cars a missile fired by `r` could go for: ahead of it in the race, not
   * knocked out or just recovering, not already chased by a missile, and
   * closer than `range` px along the road. On Easy, rivals never aim at you.
   */
  targets(r: Racer, range = r.isPlayer ? Infinity : RIVAL_RANGE): Racer[] {
    const race = this.race;
    const ds = race.geom.ds;
    return race.racers.filter((o) => {
      if (o === r || o.finished || o.place >= r.place || o.immune > 0) return false;
      if (this.missiles.some((m) => m.target === o && !m.done)) return false;
      if (!r.isPlayer && o.isPlayer && race.rules.rivalAimAtYou <= 0) return false;
      const gap = (o.progress - r.progress) * ds;
      return gap > 0 && gap < Math.min(range, race.geom.length * 0.9);
    });
  }

  /**
   * Uses one of the items a car holds: its shield goes up (unless one is up
   * already, so none is wasted), or its missile goes for a random car ahead
   * (a rival's only for one within RIVAL_RANGE). An item that can't be used
   * yet stays in hand (returns false).
   */
  use(r: Racer, kind: ItemKind): boolean {
    if (!r.held[kind]) return false;
    if (kind === 'shield') {
      if (r.shield > 0) return false;
      r.held.shield = false;
      r.shield = SHIELD_TIME;
      this.race.events.push({ type: 'shieldUp', racer: r });
      return true;
    }
    const list = this.targets(r, r.isPlayer ? Infinity : RIVAL_RANGE);
    if (!list.length) {
      this.race.events.push({ type: 'noTarget', racer: r });
      return false;
    }
    // a rival picks you less often on the easier levels
    const weights = list.map((o) => (o.isPlayer && !r.isPlayer ? this.race.rules.rivalAimAtYou : 1));
    let pick = Math.random() * weights.reduce((a, w) => a + w, 0);
    let target = list[list.length - 1];
    for (let k = 0; k < list.length; k++) {
      pick -= weights[k];
      if (pick <= 0) {
        target = list[k];
        break;
      }
    }
    r.held.missile = false;
    const b = r.body;
    this.missiles.push({
      owner: r,
      target,
      x: b.x + Math.cos(b.angle) * r.spec.halfLength,
      y: b.y + Math.sin(b.angle) * r.spec.halfLength,
      z: b.z,
      angle: b.angle,
      s: (r.progress + r.probe.t) * this.race.geom.ds,
      lateral: r.probe.lateral,
      homing: false,
      age: 0,
      done: false,
    });
    this.race.events.push({ type: 'missile', racer: r, target });
    return true;
  }

  /** How far the nearest missile aimed at `r` still has to go, px (Infinity if none). */
  incoming(r: Racer): number {
    let best = Infinity;
    for (const m of this.missiles) {
      if (m.target !== r || m.done) continue;
      const d = m.homing ? Math.hypot(r.body.x - m.x, r.body.y - m.y) : this.roadLeft(m);
      best = Math.min(best, d);
    }
    return best;
  }

  /** Road between a missile and its target, px. */
  private roadLeft(m: Missile): number {
    return (m.target.progress + m.target.probe.t) * this.race.geom.ds - m.s;
  }

  private fly(m: Missile, dt: number): void {
    const t = m.target;
    m.age += dt;
    if (m.age > MISSILE_LIFE || t.finished) {
      m.done = true;
      this.race.events.push({ type: 'fizzle', x: m.x, y: m.y });
      return;
    }
    const step = MISSILE_SPEED * dt;
    const tb = t.body;
    if (!m.homing && this.roadLeft(m) < MISSILE_HOMING) m.homing = true;
    if (m.homing) {
      const dx = tb.x - m.x;
      const dy = tb.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, step / d);
      m.x += dx * k;
      m.y += dy * k;
      m.z += (tb.z - m.z) * k;
      m.angle = Math.atan2(dy, dx);
    } else {
      // along the road, drifting sideways onto the target's line
      m.s += step;
      m.lateral += (t.probe.lateral - m.lateral) * Math.min(1, 2.5 * dt);
      const p = pointAt(this.race.geom, m.s, m.lateral);
      m.angle = Math.atan2(p.y - m.y, p.x - m.x);
      m.x = p.x;
      m.y = p.y;
      m.z = heightAt(this.race.geom, m.s);
    }
    if (near(m, tb, t.spec.radius + 4, 20)) this.hit(m);
  }

  private hit(m: Missile): void {
    m.done = true;
    const t = m.target;
    const blocked = t.shield > 0;
    let lost = 0;
    if (blocked) t.shield = 0;
    else if (t.immune <= 0) {
      t.body.stun = STUN_TIME;
      t.immune = STUN_TIME + IMMUNE_AFTER;
      lost = this.loseCoins(t, COINS_LOST_HIT);
      this.race.crashDrift(t);
    }
    this.race.events.push({ type: 'boom', racer: t, by: m.owner, x: m.x, y: m.y, blocked, lost });
  }
}
