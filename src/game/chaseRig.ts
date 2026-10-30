// The chase camera's rig and how it follows the car. Shared by both chase
// renderers (three.js, and the software "mode 7" fallback), so they frame the
// car identically. Pure code, no engine.
import type { CarBody } from './physics.ts';
import { forwardSpeed } from './physics.ts';

/**
 * Camera rig, in world pixels. With these numbers your car always sits at
 * exactly 2x size, 210 px down the 480x270 screen.
 */
export const CHASE = {
  /** Screen row of the horizon (the camera looks level; the lens is shifted down). */
  horizon: 60,
  /** Larger = narrower view (300 gives about 77 degrees across). */
  focal: 300,
  height: 75,
  /** How far behind the car the camera hovers. */
  behind: 150,
  /** Distant ground and scenery fade into the horizon haze between these depths. */
  fogStart: 450,
  fogEnd: 2000,
};

/** Anything this much closer to the camera than your car turns see-through, so it never hides you. */
export const SEE_THROUGH = 12;

/** Particle effects the race can ask for; the same names as the overhead view's emitters. */
export type EffectKind = 'dust' | 'sparks' | 'smoke' | 'flame' | 'nitro' | 'gold' | 'debris' | 'splash';

/** What the race decided about a car this frame. */
export interface CarPose {
  /** Pupil direction row of the car sheet. */
  look: number;
  /** Bounce in px: negative is up. */
  bob: number;
}

/** How the camera rises and falls with the road: a critically damped spring this stiff, 1/s. */
const RISE_STIFFNESS = 4;

/**
 * The camera's height, following the road under the car (not the car
 * itself, so a jump doesn't throw the view about) on a soft spring that
 * smooths crests and ramps. The camera never tilts: the horizon stays level.
 */
export class HeightFollow {
  y = 0;
  private vel = 0;

  snap(y: number): void {
    this.y = y;
    this.vel = 0;
  }

  step(target: number, dt: number): number {
    for (let left = dt; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      const k = RISE_STIFFNESS;
      this.vel += (k * k * (target - this.y) - 2 * k * this.vel) * h;
      this.y += this.vel * h;
    }
    return this.y;
  }
}

/** How the view turns to follow the car: a soft spring with a speed limit. */
const TURN_STIFFNESS = 5;
const TURN_MAX = 2.6; // rad/s, about 150 degrees per second
/** Share of the car's own turning the camera copies straight away (the rest it catches up on). */
const TURN_LEAD = 0.3;

export const wrapAngle = (a: number) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The camera's heading, following a car on a critically damped spring. */
export class YawFollow {
  yaw = 0;
  private vel = 0;
  private lastAim: number | null = null;

  /** Where the camera wants to look: the direction of travel, or the nose when slow or reversing. */
  static aim(b: CarBody): number {
    const w = clamp((forwardSpeed(b) - 40) / 80, 0, 1);
    return b.angle + w * wrapAngle(Math.atan2(b.vy, b.vx) - b.angle);
  }

  /** Jumps straight behind the car. */
  snap(b: CarBody): void {
    this.yaw = YawFollow.aim(b);
    this.vel = 0;
    this.lastAim = null;
  }

  step(b: CarBody, dt: number): number {
    const target = YawFollow.aim(b);
    const rate = this.lastAim === null || dt <= 0 ? 0 : clamp(wrapAngle(target - this.lastAim) / dt, -3, 3);
    this.lastAim = target;
    // small steps keep the spring stable even when a frame is slow
    for (let left = dt; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      const err = wrapAngle(target - this.yaw);
      const k = TURN_STIFFNESS;
      this.vel = clamp(this.vel + (k * k * err + 2 * k * (TURN_LEAD * rate - this.vel)) * h, -TURN_MAX, TURN_MAX);
      this.yaw = wrapAngle(this.yaw + this.vel * h);
    }
    return this.yaw;
  }
}
