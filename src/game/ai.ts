// Computer drivers: follow the centreline with a personal lane, cut to the
// inside of bends, brake early enough for the next corner and steer around
// slower cars, obstacles and puddles. They drift through sharp bends, which
// fills their nitro, and fire it on straights. A missile they pick up goes
// at a car close ahead after a moment's wait; a shield goes up a few
// seconds after they get it (sooner if a missile is about to hit them), so
// you can see it before you fire. They use exactly the same physics as the player.
import { DRIFT_TURN, HIGH_SPEED_STEER_LOSS, slipBend, speedOf, type Controls } from './physics.ts';
import { wrapS } from '../tracks/geometry.ts';
import { ITEM_KINDS, type ItemKind } from './items.ts';
import type { Race, Racer } from './race.ts';

/** Drivers look this far down the road (px) for obstacles and puddles to steer round. */
const HAZARD_LOOK = 150;
/** A rival puts its shield up this many seconds after picking it up (shortest, longest)... */
const SHIELD_HOLD: [number, number] = [1.5, 5];
/** ...or straight away when a missile aimed at it is this close (px of road). */
const SHIELD_AT = 170;

export class AIDriver {
  /** Preferred sideways offset from the centreline, in px. */
  lane: number;
  /** 0..1, scales how fast this driver dares to go. */
  skill: number;
  private stuck = 0;
  private reverse = 0;
  private dodge = 0;
  private dodgeTime = 0;
  private phase: number;
  /** For each kind of item: whether one was in hand last step, and seconds until this driver uses it. */
  private readonly had: Record<ItemKind, boolean> = { missile: false, shield: false };
  private readonly wait: Record<ItemKind, number> = { missile: 0, shield: 0 };
  private readonly out: Controls = { throttle: 0, steer: 0, drift: false, nitro: false, missile: false, shield: false };

  constructor(lane: number, skill: number, phase: number) {
    this.lane = lane;
    this.skill = skill;
    this.phase = phase;
  }

  drive(race: Race, r: Racer, dt: number): Controls {
    const g = race.geom;
    const b = r.body;
    const spec = r.spec;
    const n = g.n;
    const speed = speedOf(b);
    const ctl = this.out;
    this.useItems(race, r, dt);

    // knocked out by a missile: nothing to do but wait (and it isn't being stuck)
    if (b.stun > 0) {
      this.stuck = 0;
      this.reverse = 0;
      ctl.throttle = 0;
      ctl.steer = 0;
      ctl.drift = false;
      ctl.nitro = false;
      return ctl;
    }

    // get unstuck: back off the wall for a moment
    if (race.started && speed < 14) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.1) {
      this.reverse = 0.7;
      this.stuck = 0;
    }

    const look = 26 + speed * 0.36;
    const j = (r.seg + Math.round(look / g.ds)) % n;
    const kAhead = g.curv[(r.seg + Math.round((look + 50) / g.ds)) % n];
    const bend = Math.min(1, Math.abs(kAhead) * 110);
    const inside = Math.sign(kAhead) * bend * g.halfWidth * 0.5;

    // dodge slower cars right in front of us
    this.dodgeTime = Math.max(0, this.dodgeTime - dt);
    if (this.dodgeTime === 0) this.dodge = 0;
    for (const o of race.racers) {
      if (o === r) continue;
      const ahead = (o.progress - r.progress) * g.ds;
      if (ahead > 4 && ahead < 70 && Math.abs(o.probe.lateral - r.probe.lateral) < 18 && speedOf(o.body) < speed + 10) {
        this.dodge = o.probe.lateral > r.probe.lateral ? -1 : 1;
        if (Math.abs(o.probe.lateral) > g.halfWidth * 0.5) this.dodge = -Math.sign(o.probe.lateral);
        this.dodgeTime = 0.9;
        break;
      }
    }

    const wiggle = Math.sin(race.time * 0.7 + this.phase) * 4;
    let target = this.lane * (1 - bend) + inside + this.dodge * g.halfWidth * 0.5 + wiggle;
    target = this.avoidHazards(race, r, target);
    const lim = g.halfWidth - 10;
    target = target < -lim ? -lim : target > lim ? lim : target;
    const tx = g.x[j] - g.ty[j] * target;
    const ty = g.y[j] + g.tx[j] * target;
    // in a drift the nose points into the bend, so steer by the direction of travel instead
    const heading = b.drift ? Math.atan2(b.vy, b.vx) : b.angle;
    let diff = Math.atan2(ty - b.y, tx - b.x) - heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    let steer = Math.max(-1, Math.min(1, diff * 2.8));
    if (b.drift) {
      // In a drift the steering sets how fast the path bends (see stepCar):
      // bend it exactly enough for an arc through the target point.
      const dist = Math.max(20, Math.hypot(tx - b.x, ty - b.y));
      const need = ((2 * Math.sin(diff)) / dist) * speed;
      const bend = (need * b.drift) / (spec.turnRate * DRIFT_TURN * slipBend(b.slip));
      steer = Math.max(-1, Math.min(1, (2 * bend - 1) * b.drift));
    }

    if (this.reverse > 0) {
      this.reverse -= dt;
      ctl.throttle = -1;
      ctl.steer = -steer;
      ctl.drift = false;
      ctl.nitro = false;
      return ctl;
    }

    // plan speed: the slowest corner ahead, minus the distance we can brake in
    // (and no braking away our own nitro on the straight)
    const top = spec.maxSpeed * (1 + b.bonus);
    const maxV = b.nitroTime > 0 ? top * 1.4 : top * this.skill * race.rubberBand(r);
    let vTarget = maxV;
    const tr = spec.turnRate;
    for (let m = 2; m * g.ds < 380; m += 2) {
      const k = Math.abs(g.curv[(r.seg + m) % n]);
      if (k < 1e-4) continue;
      const radius = 1 / k;
      // fastest speed at which full lock still holds this radius (see maxYawRate)
      let vc = (tr * radius) / (1 + (HIGH_SPEED_STEER_LOSS * tr * radius) / spec.maxSpeed);
      vc *= 0.82 + 0.12 * this.skill;
      const allowed = Math.sqrt(vc * vc + 2 * spec.brake * 0.6 * m * g.ds);
      if (allowed < vTarget) vTarget = allowed;
    }
    let throttle = speed < vTarget - 4 ? 1 : speed > vTarget + 16 ? -1 : 0.35;
    if (Math.abs(diff) > 0.9 && speed > 90) throttle = Math.min(throttle, 0);
    ctl.throttle = throttle;
    ctl.steer = steer;

    // drift through sharp bends close ahead: flick the tail out, then let the
    // steering hold the slide until the bend opens up
    let sharp = 0;
    for (let m = 0; m * g.ds < 90; m += 2) {
      const k = g.curv[(r.seg + m) % n];
      if (Math.abs(k) > Math.abs(sharp)) sharp = k;
    }
    const wantDrift = Math.abs(sharp) > 1 / 240 && speed > spec.maxSpeed * 0.55 && Math.sign(steer) === Math.sign(sharp) && r.surface === 'road';
    ctl.drift = b.drift ? b.driftTime < 0.35 : wantDrift;

    // nitro on a straight
    let straight = true;
    for (let m = 0; m * g.ds < 320 && straight; m += 3) straight = Math.abs(g.curv[(r.seg + m) % n]) < 1 / 350;
    ctl.nitro = b.nitro >= 1 && straight && speed > spec.maxSpeed * 0.5 && !b.drift;
    return ctl;
  }

  /** Decides whether to fire the missile and put up the shield this step (each kind on its own clock). */
  private useItems(race: Race, r: Racer, dt: number): void {
    const ctl = this.out;
    const pause = (range: [number, number]) => range[0] + Math.random() * (range[1] - range[0]);
    for (const kind of ITEM_KINDS) {
      if (r.held[kind] && !this.had[kind]) this.wait[kind] = pause(kind === 'shield' ? SHIELD_HOLD : race.rules.rivalMissileWait);
      this.had[kind] = r.held[kind];
      this.wait[kind] -= dt;
    }
    ctl.missile = false;
    ctl.shield = false;
    if (r.body.stun > 0) return;
    if (r.held.shield && r.shield <= 0) ctl.shield = race.items.incoming(r) < SHIELD_AT || this.wait.shield <= 0;
    if (!r.held.missile || this.wait.missile > 0) return;
    const targets = race.items.targets(r);
    if (!targets.length) return;
    // when you're the only car in range, a rival on an easier level often holds its fire a while longer
    if (targets.every((t) => t.isPlayer) && Math.random() > race.rules.rivalAimAtYou) this.wait.missile = pause(race.rules.rivalMissileWait);
    else ctl.missile = true;
  }

  /** Moves the aim sideways to pass obstacles and puddles coming up on the driver's line. */
  private avoidHazards(race: Race, r: Racer, target: number): number {
    const g = race.geom;
    const items = race.items;
    const room = r.spec.radius + 5;
    const lim = g.halfWidth - 10;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const h of [...items.obstacles.filter((o) => o.respawn <= 0).map((o) => ({ s: o.s, lateral: o.lateral, size: 6 })), ...items.puddles.map((q) => ({ s: q.s, lateral: q.lateral, size: q.r * 0.9 }))]) {
        const ahead = wrapS(g, h.s - r.probe.s);
        if (ahead < -8 || ahead > HAZARD_LOOK) continue;
        const clear = h.size + room;
        if (Math.abs(target - h.lateral) >= clear) continue;
        // pass on the side the aim is already leaning to, unless that side is too narrow
        const left = h.lateral - clear;
        const right = h.lateral + clear;
        const preferRight = target >= h.lateral;
        target = preferRight ? (right <= lim ? right : left) : left >= -lim ? left : right;
        moved = true;
      }
      if (!moved) break;
    }
    return target;
  }
}
