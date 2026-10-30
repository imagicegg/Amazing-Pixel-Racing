// Arcade car handling. Velocity is split into a forward part (engine, brakes)
// and a sideways part (grip). Low grip = the car slides, which is also how
// drifting works. Pure TypeScript, so it can be unit-tested in Node.
import type { CarStats } from '../art/cars.ts';
import type { Surface } from '../tracks/themes.ts';

export interface CarSpec {
  maxSpeed: number;
  accel: number;
  brake: number;
  reverse: number;
  /** Turn rate at full lock, rad/s. */
  turnRate: number;
  /** How fast sideways sliding is damped, 1/s. */
  grip: number;
  mass: number;
  /** Collision radius. */
  radius: number;
  /** Half the body length, used for the nose/tail wall checks. */
  halfLength: number;
}

export function specFromStats(stats: CarStats, spriteW: number, spriteH: number): CarSpec {
  return {
    maxSpeed: 222 + 9 * stats.speed,
    accel: 100 + 24 * stats.accel,
    brake: 330,
    reverse: 80,
    turnRate: 2.25 + 0.32 * stats.handling,
    grip: 9 + 2.2 * stats.handling,
    mass: 0.7 + 0.16 * stats.weight,
    radius: Math.round(spriteW / 2) - 1,
    halfLength: Math.round(spriteH / 2) - 2,
  };
}

/** No car turns tighter than this circle, so slow cars don't spin on the spot. */
export const MIN_TURN_RADIUS = 36;
/** Share of the turn rate lost at top speed: fast cars steer more gently. */
export const HIGH_SPEED_STEER_LOSS = 0.4;
/** Steering wheel speed (full lock per second) when turning in, and when straightening up. */
const STEER_IN = 4.5;
const STEER_OUT = 9;

/** Turn rate (rad/s) at full lock for a forward speed in px/s. */
export function maxYawRate(spec: CarSpec, speed: number): number {
  const v = Math.abs(speed);
  return Math.min(v / MIN_TURN_RADIUS, spec.turnRate * (1 - HIGH_SPEED_STEER_LOSS * Math.min(1, v / spec.maxSpeed)));
}

export interface Controls {
  /** -1 (brake / reverse) .. 1 (full throttle) */
  throttle: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** The drift button (like a handbrake: flicks the tail out, holds a wider slide). */
  drift: boolean;
  /** Fire the nitro (only does something when the gauge is full). */
  nitro: boolean;
  /** Fire the missile in hand; it goes off once per press. */
  missile: boolean;
  /** Put up the shield in hand; once per press. */
  shield: boolean;
}

export const NO_CONTROLS: Controls = { throttle: 0, steer: 0, drift: false, nitro: false, missile: false, shield: false };

export interface CarBody {
  x: number;
  y: number;
  /** Heading in radians, 0 = facing +x. */
  angle: number;
  vx: number;
  vy: number;
  /** Smoothed steering, -1..1. */
  steer: number;
  /** Seconds of boost-pad boost left. */
  boost: number;
  /** 0 when not drifting, otherwise -1 / 1 for the drift direction. */
  drift: number;
  /** Seconds spent in the current drift. */
  driftTime: number;
  /** While drifting: how far the nose points into the bend from the direction of travel (radians). */
  slip: number;
  /** Nitro gauge, 0..1. It can be fired only when full. */
  nitro: number;
  /** Seconds of nitro burn left (the gauge empties as it burns). */
  nitroTime: number;
  /** Seconds a wall knock can still hold the car to `knockSpeed`. */
  knock: number;
  /** Top speed after a wall hit: the car slows down to it gradually instead of stopping dead. */
  knockSpeed: number;
  /** How far (radians) a wall hit is still swinging the nose round to run along the wall. */
  knockYaw: number;
  /** Extra top speed as a share (gold coins add 1% each). */
  bonus: number;
  /** Seconds the car is knocked out for (hit by a missile): it skids to a stop and can't drive. */
  stun: number;
  /** Height above the plain, px, and how fast it is changing (px/s, up is positive). */
  z: number;
  vz: number;
  /** Seconds in the air so far (0 while the wheels are on the road). See Race.vertical. */
  air: number;
  /** Speed beyond the usual top speed built up going downhill, px/s; it fades away on the level. */
  surge: number;
}

export function newBody(x: number, y: number, angle: number, z = 0): CarBody {
  return { x, y, angle, vx: 0, vy: 0, steer: 0, boost: 0, drift: 0, driftTime: 0, slip: 0, nitro: 0, nitroTime: 0, knock: 0, knockSpeed: 0, knockYaw: 0, bonus: 0, stun: 0, z, vz: 0, air: 0, surge: 0 };
}

/**
 * Gravity, px/s². Several times real gravity at this scale (a car is about
 * 4 m long), so jumps are short and punchy and slopes are worth having. It
 * also pulls cars along a slope: a downhill speeds you up.
 */
export const GRAVITY = 400;
/** In the air the nose still turns with the steering, at this share of the usual rate (the path does not). */
const AIR_TURN = 0.35;
/** A downhill can carry a car up to this share past its top speed... */
const SURGE_MAX = 0.3;
/** ...and on the level or uphill that extra fades at this rate, px/s². */
const SURGE_FADE = 40;

/** How hard a knocked-out car stops, 1/s: from top speed to a standstill in about half a second. */
const STUN_BRAKE = 7;

/**
 * After a wall hit (see Race.walls) the nose swings round to run along the
 * wall at this rate, rad/s, with the tyres loose (this share of their grip)
 * while it turns, so the car slides on instead of scrubbing its speed away.
 */
const KNOCK_TURN = 6;
const KNOCK_GRIP = 0.2;

/** Length of a nitro burst, seconds, and what it does to top speed and acceleration. */
export const NITRO_TIME = 2.6;
const NITRO_TOP = 1.4;
const NITRO_PUSH = 600;

/**
 * Drift handling, Need for Speed style. The drift button plus steering at
 * speed flicks the tail out. From then on the car slides along its path with
 * its nose turned into the bend, and the steering sets the slide angle:
 * into the bend for a wide, tight slide, straight for a medium one, against
 * it to straighten up and leave the drift. Holding the drift button adds
 * angle, like a handbrake. Wider slides turn the car's path faster but cap
 * its speed lower.
 */
const DRIFT_MIN_SPEED = 0.42;
/**
 * Target slide angles (radians): [into the bend, straight, counter-steer],
 * with the button held / released. Letting go of everything fades the drift
 * out by itself.
 */
const SLIP_HELD = [0.8, 0.5, 0.1];
const SLIP_FREE = [0.64, 0, 0.06];
/** The drift ends once the slide is narrower than this. */
const SLIP_END = 0.12;
/** How fast the path turns in a drift, as a share of the car's turn rate. */
export const DRIFT_TURN = 0.95;
/** Share of top speed a full 90 degree slide would cost (sin-weighted). */
const DRIFT_DRAG = 0.3;

/** A narrow slide bends the path less, so a drift that fades out straightens up smoothly. */
export function slipBend(slip: number): number {
  return Math.min(1, Math.max(0.3, slip / 0.3));
}

export interface StepResult {
  /** True on the step a drift starts. */
  driftStart: boolean;
  /** True on the step a drift ends. */
  driftEnd: boolean;
  /** True on the step the nitro is fired. */
  nitroFired: boolean;
}

const result: StepResult = { driftStart: false, driftEnd: false, nitroFired: false };

export function speedOf(b: CarBody): number {
  return Math.hypot(b.vx, b.vy);
}

/** Signed speed along the heading. */
export function forwardSpeed(b: CarBody): number {
  return b.vx * Math.cos(b.angle) + b.vy * Math.sin(b.angle);
}

/** Turns the steering wheel towards the input: winds up gradually, springs back twice as fast. */
function windSteering(b: CarBody, ctl: Controls, dt: number): void {
  const ds = ctl.steer - b.steer;
  const outward = ctl.steer !== 0 && (b.steer === 0 || Math.sign(ds) === Math.sign(b.steer));
  const rate = (outward ? STEER_IN : STEER_OUT) * dt;
  b.steer += ds > rate ? rate : ds < -rate ? -rate : ds;
}

/** Fires a full nitro gauge on request and burns it down; true while it burns. */
function burnNitro(b: CarBody, ctl: Controls, dt: number): boolean {
  if (ctl.nitro && b.nitro >= 1 && b.nitroTime <= 0) {
    b.nitroTime = NITRO_TIME;
    result.nitroFired = true;
  }
  if (b.nitroTime <= 0) return false;
  b.nitroTime = Math.max(0, b.nitroTime - dt);
  b.nitro = b.nitroTime / NITRO_TIME;
  return true;
}

/**
 * In the air: no grip and no engine, so the car flies on the way it left the
 * ramp. The steering still turns the nose a little (not the path), so you
 * can line up the landing; the timers keep running.
 */
function flyCar(b: CarBody, spec: CarSpec, ctl: Controls, dt: number): StepResult {
  windSteering(b, ctl, dt);
  burnNitro(b, ctl, dt);
  b.boost = Math.max(0, b.boost - dt);
  b.knock = Math.max(0, b.knock - dt);
  b.stun = Math.max(0, b.stun - dt);
  if (b.drift) b.driftTime += dt;
  else if (b.stun <= 0) b.angle = wrapAngle(b.angle + b.steer * maxYawRate(spec, forwardSpeed(b)) * AIR_TURN * dt);
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  return result;
}

/**
 * One physics step on the ground (or in the air, see flyCar). `slopeX` and
 * `slopeY` are the road's slope where the car is: height gained per px
 * moved east and per px moved south. Gravity pulls the car along it.
 */
export function stepCar(b: CarBody, spec: CarSpec, ctl: Controls, ground: Surface, dt: number, slopeX = 0, slopeY = 0): StepResult {
  result.driftStart = false;
  result.driftEnd = false;
  result.nitroFired = false;
  if (b.air > 0) return flyCar(b, spec, ctl, dt);
  // knocked out: skid to a stop where the car points (no spin), no driving; the boost and nitro wait
  if (b.stun > 0) {
    b.stun = Math.max(0, b.stun - dt);
    const k = Math.exp(-STUN_BRAKE * dt);
    b.vx *= k;
    b.vy *= k;
    b.steer = 0;
    b.knock = 0;
    b.knockYaw = 0;
    if (b.drift) {
      b.drift = 0;
      b.driftTime = 0;
      b.slip = 0;
      result.driftEnd = true;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    return result;
  }
  const fx = Math.cos(b.angle);
  const fy = Math.sin(b.angle);
  let vf = b.vx * fx + b.vy * fy;
  let vl = -b.vx * fy + b.vy * fx;

  // The steering wheel winds up gradually, so a quick tap is a small
  // correction, and springs back twice as fast, so the car settles straight.
  windSteering(b, ctl, dt);

  // nitro: a full gauge burns for NITRO_TIME, emptying as it goes
  const nitroOn = burnNitro(b, ctl, dt);

  const boosting = b.boost > 0;
  let vmax = spec.maxSpeed * (1 + b.bonus) * ground.speed * Math.max(boosting ? 1.32 : 1, nitroOn ? NITRO_TOP : 1);
  // a wall hit holds the car to a lower top speed until it has slowed down to it
  if (b.knock > 0) {
    b.knock = Math.max(0, b.knock - dt);
    if (Math.hypot(b.vx, b.vy) <= b.knockSpeed) b.knock = 0;
    else vmax = Math.min(vmax, b.knockSpeed);
    // ...and loses what a downhill had built up
    b.surge = 0;
  }
  // Running downhill (a drop of more than 1 in 200 the way the car is going)
  // builds up speed past the usual top speed; elsewhere that extra fades.
  const moving = Math.atan2(b.vy, b.vx);
  const fall = -(slopeX * Math.cos(moving) + slopeY * Math.sin(moving));
  const downhill = fall > 0.005 && Math.hypot(b.vx, b.vy) > 20;
  if (!downhill) b.surge = Math.max(0, b.surge - SURGE_FADE * dt);
  const surgeCap = SURGE_MAX * spec.maxSpeed;

  // engine and brakes
  if (ctl.throttle > 0) {
    if (vf < vmax) {
      const a = spec.accel * ground.accel * ctl.throttle * (1 - (0.5 * Math.max(0, vf)) / vmax);
      vf = Math.min(vmax, vf + a * dt);
    }
  } else if (ctl.throttle < 0) {
    if (vf > 8) vf = Math.max(0, vf - spec.brake * -ctl.throttle * dt);
    else vf = Math.max(-spec.reverse, vf - spec.accel * 0.8 * -ctl.throttle * dt);
  } else {
    const r = 70 * dt;
    vf = Math.abs(vf) <= r ? 0 : vf - Math.sign(vf) * r;
  }
  // nitro pushes only on the throttle, so you can still brake for a corner
  const push = (boosting ? 520 : 0) + (nitroOn && ctl.throttle > 0 ? NITRO_PUSH : 0);
  if (push) vf = Math.min(vmax, vf + push * dt);
  if (boosting) b.boost = Math.max(0, b.boost - dt);
  // gravity along the slope: uphill slows the car, downhill speeds it up
  vf -= GRAVITY * (slopeX * fx + slopeY * fy) * dt;
  if (downhill && vf > vmax) b.surge = Math.min(surgeCap, Math.max(b.surge, vf - vmax));
  // too fast for this surface (e.g. just left the asphalt) or after a wall hit: scrub speed off
  const top = vmax + b.surge;
  if (vf > top) vf = Math.max(top, vf - ground.scrub * dt);

  // off the road a drift can't start, and one that runs onto the grass or sand straightens out
  const offroad = ground.speed < 0.9;
  // drifting: the drift button while steering at speed flicks the tail out
  if (!b.drift && !offroad && ctl.drift && vf > spec.maxSpeed * DRIFT_MIN_SPEED && Math.abs(ctl.steer) > 0.25) {
    b.drift = Math.sign(ctl.steer);
    b.driftTime = 0;
    // start from whatever slide the car already has, so nothing jumps
    const dir = Math.atan2(b.vy, b.vx);
    b.slip = Math.max(0, b.drift * wrapAngle(b.angle - dir));
    // the drift sets the nose angle from here on, so a wall's swing still to come is dropped
    b.knockYaw = 0;
    result.driftStart = true;
  }
  if (b.drift) {
    b.driftTime += dt;
    // the steering wheel's position (not the raw keys), so a keyboard slides smoothly
    const into = b.steer * b.drift;
    const targets = ctl.drift ? SLIP_HELD : SLIP_FREE;
    const target = offroad ? 0 : into > 0.2 ? targets[0] : into < -0.2 ? targets[2] : targets[1];
    // the first moment of a drift kicks the tail out quickly. Off the road the slide
    // unwinds just as fast (ending it at once would scrub the sideways speed off in a jolt).
    b.slip += (target - b.slip) * Math.min(1, (b.driftTime < 0.3 || offroad ? 9 : 4) * dt);
    const straightened = (b.driftTime > 0.3 || offroad) && b.slip < SLIP_END;
    if (straightened || vf < spec.maxSpeed * 0.3) {
      b.drift = 0;
      b.driftTime = 0;
      b.slip = 0;
      result.driftEnd = true;
    }
  }
  if (b.drift) {
    // the path bends towards the drift: more when steering into it, hardly at all against it
    let speed = Math.hypot(b.vx, b.vy);
    let dir = Math.atan2(b.vy, b.vx);
    const into = b.steer * b.drift;
    const bend = Math.min(1, Math.max(0.05, 0.5 + 0.5 * into)) * slipBend(b.slip);
    dir = wrapAngle(dir + b.drift * spec.turnRate * DRIFT_TURN * bend * dt);
    // a wider slide holds a lower top speed; the throttle keeps you up to it
    const cap = (vmax + b.surge) * (1 - DRIFT_DRAG * Math.sin(b.slip));
    if (ctl.throttle > 0 && speed < cap) speed = Math.min(cap, speed + spec.accel * 0.7 * ctl.throttle * dt);
    else if (speed > cap) speed = Math.max(cap, speed - 90 * dt);
    if (ctl.throttle < 0) speed = Math.max(0, speed - spec.brake * 0.6 * dt);
    if (push) speed = Math.min(vmax, speed + push * dt);
    speed = Math.max(0, speed - GRAVITY * (slopeX * Math.cos(dir) + slopeY * Math.sin(dir)) * dt);
    if (downhill && speed > vmax) b.surge = Math.min(surgeCap, Math.max(b.surge, speed - vmax));
    // ...and the nose points into the bend by the slide angle
    b.angle = wrapAngle(dir + b.drift * b.slip);
    b.vx = Math.cos(dir) * speed;
    b.vy = Math.sin(dir) * speed;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    return result;
  }

  // turning: needs speed, and gets gentler as the car goes faster
  b.angle = wrapAngle(b.angle + b.steer * maxYawRate(spec, vf) * (vf >= 0 ? 1 : -1) * dt);

  let grip = spec.grip * ground.grip;
  if (b.knockYaw !== 0) {
    const turn = Math.sign(b.knockYaw) * Math.min(Math.abs(b.knockYaw), KNOCK_TURN * dt);
    b.angle = wrapAngle(b.angle + turn);
    b.knockYaw -= turn;
    grip *= KNOCK_GRIP;
  }
  // grip kills sideways sliding
  vl *= Math.exp(-grip * dt);

  b.vx = fx * vf - fy * vl;
  b.vy = fy * vf + fx * vl;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  return result;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Sideways sliding speed (for skid marks and dust). */
export function slipSpeed(b: CarBody): number {
  return Math.abs(-b.vx * Math.sin(b.angle) + b.vy * Math.cos(b.angle));
}

export interface BumpResult {
  /** Closing speed of the impact (0 = no contact). */
  impact: number;
  x: number;
  y: number;
}

/** Elastic-ish push between two round cars. */
export function collideCars(a: CarBody, sa: CarSpec, b: CarBody, sb: CarSpec): BumpResult {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = sa.radius + sb.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 < 1e-6) return { impact: 0, x: 0, y: 0 };
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const overlap = rr - d;
  const ia = 1 / sa.mass;
  const ib = 1 / sb.mass;
  const share = overlap / (ia + ib);
  a.x -= nx * share * ia;
  a.y -= ny * share * ia;
  b.x += nx * share * ib;
  b.y += ny * share * ib;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv < 0) {
    const j = (-(1 + 0.45) * rv) / (ia + ib);
    a.vx -= j * ia * nx;
    a.vy -= j * ia * ny;
    b.vx += j * ib * nx;
    b.vy += j * ib * ny;
  }
  return { impact: Math.max(0, -rv), x: a.x + nx * sa.radius, y: a.y + ny * sa.radius };
}
