// Software fallback for the CHASE view, used when three.js can't start (see
// ChaseView3D.ts for the real one). A pseudo-3D "mode 7" camera like the
// classic kart racers: the ground and sky are drawn in software into one
// canvas each frame (see tracks/perspective.ts); cars, scenery and effects are
// flat sprites placed and scaled by projecting their spot on the ground.
// The course is shown flat (no hills or bridges); a jumping car still rises.
import Phaser from 'phaser';
import { GAME_H, GAME_W, UI } from '../config.ts';
import { Raster, hex, mix, shade, toRGBInt } from '../art/raster.ts';
import { carPalette, directionFrame } from '../art/sprites.ts';
import { carFrame, carKey } from '../ui/textures.ts';
import { project, renderGround, type GroundStyle, type PerspectiveCamera, type Projected } from '../tracks/perspective.ts';
import { buildPanorama } from '../tracks/sky.ts';
import { groundOf, propKey, type LoadedTrack } from '../tracks/trackCache.ts';
import type { Theme } from '../tracks/themes.ts';
import type { Race } from '../game/race.ts';
import { DEBRIS } from '../art/itemArt.ts';
import { OBSTACLE_RESPAWN } from '../game/items.ts';
import { missileFrame } from './ItemSprites.ts';
import { CHASE, SEE_THROUGH, YawFollow, type CarPose, type EffectKind } from '../game/chaseRig.ts';

/** Height of a car's body under its roof, in world px. */
const BODY = 4;

interface CarSprites {
  shadow: Phaser.GameObjects.Image;
  /** Body slices from the ground up; stacked, they give the car its sides. */
  body: Phaser.GameObjects.Image[];
  roof: Phaser.GameObjects.Image;
  cone: Phaser.GameObjects.Image | null;
}

interface Bit {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  total: number;
  size0: number;
  size1: number;
  alpha: number;
  gravity: number;
}

interface EffectStyle {
  texture: string;
  life: number;
  speed: [number, number];
  rise: [number, number];
  gravity: number;
  alpha: number;
  size: [number, number];
  tint: number[];
  add: boolean;
}

const POOL = 160;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class ChaseView {
  readonly layer: Phaser.GameObjects.Layer;
  private readonly scene: Phaser.Scene;
  private readonly race: Race;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly cam: PerspectiveCamera;
  private readonly levels: Raster[];
  private readonly style: GroundStyle;
  private readonly sky: Raster;
  /** Viewing angle of every screen column, relative to the camera's heading. */
  private readonly columnAngle: Float32Array;
  private readonly props: { img: Phaser.GameObjects.Image; x: number; y: number; w: number; glow: Phaser.GameObjects.Image | null }[] = [];
  private readonly cars: CarSprites[] = [];
  /** The race items as billboards (see game/items.ts). */
  private readonly items: {
    coins: Phaser.GameObjects.Image[];
    pickups: { icon: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }[];
    obstacles: Phaser.GameObjects.Image[];
    missiles: Phaser.GameObjects.Image[];
    shields: Phaser.GameObjects.Image[];
    stars: Phaser.GameObjects.Image[][];
  };
  private time = 0;
  private readonly bits: Bit[] = [];
  private readonly effects: Record<EffectKind, EffectStyle>;
  private readonly skidColor: number;
  private nextBit = 0;
  private readonly follow = new YawFollow();
  private yaw = 0;
  private readonly p: Projected = { sx: 0, sy: 0, depth: 0, scale: 0 };
  private readonly p2: Projected = { sx: 0, sy: 0, depth: 0, scale: 0 };
  private readonly p3: Projected = { sx: 0, sy: 0, depth: 0, scale: 0 };

  constructor(scene: Phaser.Scene, track: LoadedTrack, race: Race, theme: Theme) {
    this.scene = scene;
    this.race = race;
    const key = 'chase-view';
    const existing = scene.textures.exists(key) ? scene.textures.get(key) : null;
    this.tex = (existing as Phaser.Textures.CanvasTexture | null) ?? scene.textures.createCanvas(key, GAME_W, GAME_H)!;
    this.cam = { x: 0, y: 0, yaw: 0, height: CHASE.height, focal: CHASE.focal, horizon: CHASE.horizon, centerX: GAME_W / 2 };

    // skid marks are painted into private copies of the two sharpest levels
    const pristine = groundOf(track);
    const copy = (r: Raster) => new Raster(r.w, r.h, r.px.slice());
    this.levels = [copy(pristine[0]), copy(pristine[1]), pristine[2], pristine[3]];
    const def = race.geom.def;
    const pano = buildPanorama(def.theme, Math.round(Math.PI * 2 * CHASE.focal), CHASE.horizon, def.seed);
    this.sky = pano.raster;
    this.style = { fog: pano.haze, fogStart: CHASE.fogStart, fogEnd: CHASE.fogEnd, outside: hex(theme.ground.base) };
    this.columnAngle = new Float32Array(GAME_W);
    for (let c = 0; c < GAME_W; c++) this.columnAngle[c] = Math.atan((c + 0.5 - this.cam.centerX) / CHASE.focal);
    this.skidColor = hex('#' + theme.skid.toString(16).padStart(6, '0'));

    // under every HUD object (the world camera never draws this layer)
    this.layer = scene.add.layer().setDepth(-1);
    this.layer.add(scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(-1e6));

    // scenery stands on its base point; its shadow is already painted on the ground
    for (const pr of track.props) {
      const img = this.sprite(propKey(scene, pr.name)).setOrigin(0.5, 1);
      // street lamps glow at night
      const glow = theme.night && pr.name === 'lamp' ? this.sprite('glow').setTint(0xffe9a8).setBlendMode(Phaser.BlendModes.ADD) : null;
      this.props.push({ img, x: pr.x + img.width / 2, y: pr.y + img.height, w: img.width, glow });
    }

    for (const r of race.racers) {
      const tex = carKey(r.design, r.alt);
      const sides = toRGBInt(shade(hex(carPalette(r.design, r.alt).B), -0.45));
      const shadow = this.sprite(tex).setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
      const body = Array.from({ length: BODY }, (_, z) =>
        this.sprite(tex).setTint(z === 0 ? UI.ink : sides).setTintMode(Phaser.TintModes.FILL),
      );
      const roof = this.sprite(tex);
      let cone: Phaser.GameObjects.Image | null = null;
      if (theme.night) cone = this.sprite('cone').setOrigin(0, 0.5).setTint(0xfff3c4).setBlendMode(Phaser.BlendModes.ADD);
      this.cars.push({ shadow, body, roof, cone });
    }

    const items = race.items;
    this.items = {
      coins: items.coins.map(() => this.sprite('item-coin')),
      pickups: items.pickups.map((pk) => ({
        glow: this.sprite('glow').setTint(pk.kind === 'missile' ? 0xff6a3d : 0x41e6ff).setBlendMode(Phaser.BlendModes.ADD),
        icon: this.sprite(pk.kind === 'missile' ? 'item-rocket' : 'item-bubble'),
      })),
      obstacles: items.obstacles.map(() => this.sprite(`ob-${items.obstacleKind}`).setOrigin(0.5, 1)),
      missiles: Array.from({ length: 8 }, () => this.sprite('item-missile')),
      shields: race.racers.map(() => this.sprite('item-shield').setBlendMode(Phaser.BlendModes.ADD)),
      stars: race.racers.map(() => [0, 1, 2].map(() => this.sprite('icon-star'))),
    };

    this.effects = {
      dust: { texture: 'puff', life: 0.5, speed: [6, 24], rise: [6, 16], gravity: 0, alpha: 0.8, size: [1, 1], tint: [theme.dust], add: false },
      sparks: { texture: 'dot', life: 0.28, speed: [40, 110], rise: [20, 60], gravity: 260, alpha: 1, size: [1, 1], tint: [UI.yellow, UI.white, UI.orange], add: true },
      smoke: { texture: 'puff', life: 0.7, speed: [4, 14], rise: [4, 12], gravity: 0, alpha: 0.55, size: [1, 2.6], tint: [0xf4f4f4, 0xd8dce8, 0xc2c8d6], add: false },
      nitro: { texture: 'puff', life: 0.22, speed: [10, 40], rise: [2, 8], gravity: 0, alpha: 0.95, size: [1.1, 0.3], tint: [UI.cyan, UI.sky, UI.white, 0x9f7fff], add: true },
      flame: { texture: 'puff', life: 0.24, speed: [10, 40], rise: [2, 10], gravity: 0, alpha: 0.9, size: [1, 0.4], tint: [UI.yellow, UI.orange, UI.red], add: true },
      gold: { texture: 'dot', life: 0.45, speed: [20, 60], rise: [20, 50], gravity: 120, alpha: 1, size: [1, 1], tint: [UI.yellow, 0xfff3a0, UI.white], add: true },
      debris: { texture: 'dot', life: 0.6, speed: [30, 90], rise: [30, 70], gravity: 260, alpha: 1, size: [1.5, 1], tint: DEBRIS[theme.obstacle], add: false },
      splash: { texture: 'puff', life: 0.45, speed: [10, 40], rise: [10, 30], gravity: 120, alpha: 0.85, size: [1, 1.6], tint: theme.puddle.colors.map((c) => toRGBInt(hex(c))), add: false },
    };
    for (let i = 0; i < POOL; i++) {
      const img = this.sprite('dot');
      this.bits.push({ img, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, total: 1, size0: 1, size1: 1, alpha: 1, gravity: 0 });
    }
  }

  private sprite(key: string): Phaser.GameObjects.Image {
    const img = this.scene.add.image(0, 0, key).setVisible(false).setVertexRoundMode('fullAuto');
    this.layer.add(img);
    return img;
  }

  setVisible(on: boolean): void {
    this.layer.setVisible(on);
  }

  /** Jumps straight behind the car (when the view is switched on). */
  snap(): void {
    this.follow.snap(this.race.player.body);
    this.yaw = this.follow.yaw;
  }

  private fog(depth: number): number {
    return clamp((depth - CHASE.fogStart) / (CHASE.fogEnd - CHASE.fogStart), 0, 1);
  }

  /** Paints a tyre mark into the ground (both levels sharp enough to show it). */
  skid(x: number, y: number): void {
    const l0 = this.levels[0];
    const x0 = Math.round(x) - 1;
    const y0 = Math.round(y) - 1;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        if (!l0.inside(x0 + i, y0 + j)) continue;
        const o = (y0 + j) * l0.w + x0 + i;
        l0.px[o] = mix(l0.px[o], this.skidColor, 0.4);
      }
    }
    const l1 = this.levels[1];
    const hx = Math.floor(x / 2);
    const hy = Math.floor(y / 2);
    if (l1.inside(hx, hy)) l1.px[hy * l1.w + hx] = mix(l1.px[hy * l1.w + hx], this.skidColor, 0.2);
  }

  emit(kind: EffectKind, x: number, y: number, count: number): void {
    const s = this.effects[kind];
    for (let n = 0; n < count; n++) {
      const bit = this.bits[this.nextBit];
      this.nextBit = (this.nextBit + 1) % POOL;
      const dir = Math.random() * Math.PI * 2;
      const speed = s.speed[0] + Math.random() * (s.speed[1] - s.speed[0]);
      bit.x = x;
      bit.y = y;
      bit.z = kind === 'dust' ? 0 : 2;
      bit.vx = Math.cos(dir) * speed;
      bit.vy = Math.sin(dir) * speed;
      bit.vz = s.rise[0] + Math.random() * (s.rise[1] - s.rise[0]);
      bit.total = s.life;
      bit.life = s.life;
      bit.size0 = s.size[0];
      bit.size1 = s.size[1];
      bit.alpha = s.alpha;
      bit.gravity = s.gravity;
      bit.img.setTexture(s.texture).setTint(s.tint[Math.floor(Math.random() * s.tint.length)]);
      bit.img.setBlendMode(s.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    }
  }

  update(dt: number, poses: readonly CarPose[]): void {
    const b = this.race.player.body;
    this.yaw = this.follow.step(b, dt);
    const cam = this.cam;
    cam.yaw = this.yaw;
    cam.x = b.x - Math.cos(this.yaw) * CHASE.behind;
    cam.y = b.y - Math.sin(this.yaw) * CHASE.behind;
    this.drawBackdrop();
    this.drawProps();
    for (const r of this.race.racers) this.drawCar(r.index, poses[r.index]);
    this.time += dt;
    this.drawItems(this.time);
    this.drawBits(dt);
  }

  /**
   * Stands a billboard on a ground point, `lift` world px up (or, `flat`, lays
   * it on the ground, foreshortened); hides it when it's out of view.
   */
  private place(img: Phaser.GameObjects.Image, x: number, y: number, lift = 0, size = 1, alpha = 1, flat = false): void {
    const p = this.p;
    if (!project(this.cam, x, y, p, 8) || p.depth > CHASE.fogEnd * 0.6) {
      img.setVisible(false);
      return;
    }
    const k = p.scale * size;
    img.setVisible(true).setPosition(p.sx, p.sy - lift * p.scale).setScale(k, flat ? k * Math.max(0.2, CHASE.height / p.depth) : k);
    img.setAlpha(alpha * (1 - this.fog(p.depth))).setDepth(-p.depth + (flat ? -0.01 : 0.002));
  }

  private drawItems(clock: number): void {
    const items = this.race.items;
    const v = this.items;
    items.coins.forEach((c, i) => {
      if (c.respawn > 0) v.coins[i].setVisible(false);
      else this.place(v.coins[i].setFrame(Math.floor(clock * 8 + i * 0.7) % 4), c.x, c.y, 5);
    });
    items.pickups.forEach((pk, i) => {
      const { icon, glow } = v.pickups[i];
      if (pk.respawn > 0) {
        icon.setVisible(false);
        glow.setVisible(false);
        return;
      }
      this.place(glow, pk.x, pk.y, 0, 0.8, 0.6, true);
      this.place(icon, pk.x, pk.y, 7 + Math.sin(clock * 3 + i) * 1.2);
    });
    items.obstacles.forEach((o, i) => {
      const img = v.obstacles[i];
      const since = OBSTACLE_RESPAWN - o.respawn;
      if (o.respawn <= 0) this.place(img.setRotation(0), o.x, o.y);
      else if (since < 0.6) this.place(img.setRotation(since * 14), o.x + o.vx * since * 0.6, o.y + o.vy * since * 0.6, Math.sin((since / 0.6) * Math.PI) * 12, 1, 1 - since / 0.6);
      else img.setVisible(false);
    });
    v.missiles.forEach((img, i) => {
      const m = items.missiles[i];
      if (!m) img.setVisible(false);
      else this.place(img.setFrame(missileFrame(m.angle - this.yaw - Math.PI / 2)), m.x, m.y, 6);
    });
    this.race.racers.forEach((r, i) => {
      const b = r.body;
      const shield = r.shield > 0 && (r.shield > 1 || Math.floor(clock * 12) % 2 === 0);
      if (shield) this.place(v.shields[i], b.x, b.y, 6, 1, 0.7);
      else v.shields[i].setVisible(false);
      v.stars[i].forEach((star, k) => {
        if (b.stun <= 0) {
          star.setVisible(false);
          return;
        }
        const a = clock * 5 + (k * Math.PI * 2) / 3;
        this.place(star, b.x + Math.cos(a) * 9, b.y + Math.sin(a) * 9, 17);
      });
    });
  }

  private drawBackdrop(): void {
    const px = this.tex.pixels;
    const sky = this.sky;
    const turn = Math.PI * 2;
    for (let c = 0; c < GAME_W; c++) {
      const a = this.yaw + this.columnAngle[c];
      const sx = ((Math.floor((a / turn) * sky.w) % sky.w) + sky.w) % sky.w;
      for (let row = 0, o = c, s = sx; row < CHASE.horizon; row++, o += GAME_W, s += sky.w) px[o] = sky.px[s];
    }
    renderGround(px.subarray(CHASE.horizon * GAME_W), GAME_W, GAME_H - CHASE.horizon, this.cam, this.levels, this.style);
    this.tex.context.putImageData(this.tex.imageData, 0, 0);
    this.tex.refresh();
  }

  private drawProps(): void {
    const p = this.p;
    for (const pr of this.props) {
      const img = pr.img;
      // behind the camera, lost in the haze, or off the sides of the screen
      if (!project(this.cam, pr.x, pr.y, p, 12) || p.depth > CHASE.fogEnd || Math.abs(p.sx - GAME_W / 2) > (GAME_W + pr.w * p.scale) / 2) {
        img.setVisible(false);
        pr.glow?.setVisible(false);
        continue;
      }
      const alpha = p.depth < CHASE.behind - SEE_THROUGH ? 0.45 : 1 - this.fog(p.depth);
      img.setVisible(true).setPosition(p.sx, p.sy).setScale(p.scale).setAlpha(alpha).setDepth(-p.depth);
      // the lamp head is 9 px up the post
      pr.glow?.setVisible(true).setPosition(p.sx, p.sy - 9 * p.scale).setScale(p.scale * 0.5).setAlpha(0.35 * alpha).setDepth(-p.depth + 0.001);
    }
  }

  private drawCar(index: number, pose: CarPose): void {
    const r = this.race.racers[index];
    const s = this.cars[index];
    const b = r.body;
    const p = this.p;
    const all = [s.shadow, ...s.body, s.roof];
    if (s.cone) all.push(s.cone);
    if (!project(this.cam, b.x, b.y, p, 8) || p.depth > CHASE.fogEnd) {
      for (const img of all) img.setVisible(false);
      return;
    }
    const k = p.scale;
    // a flat drawing seen from this height is squashed; keep far cars readable
    const q = Math.max(0.42, CHASE.height / p.depth);
    const fade = (1 - this.fog(p.depth)) * (!r.isPlayer && p.depth < CHASE.behind - SEE_THROUGH ? 0.5 : 1);
    const frame = carFrame(directionFrame(b.angle - this.yaw - Math.PI / 2), pose.look);
    const base = -p.depth;
    // bounces are half a world pixel per screen pixel of the overhead view; this
    // flat fallback shows the ground level, so only a jump's height lifts the car
    const lift = -pose.bob * 0.5 + Math.max(0, b.z - r.ground);
    const { sx, sy } = p;
    s.body.forEach((img, z) => {
      img.setVisible(true).setFrame(frame).setPosition(sx, sy - (z + lift) * k).setScale(k, k * q).setAlpha(fade).setDepth(base - 0.003 + z * 0.0005);
    });
    s.roof.setVisible(true).setFrame(frame).setPosition(sx, sy - (BODY + lift) * k).setScale(k, k * q).setAlpha(fade).setDepth(base);

    // shadow on the ground, cast by the same sun as the scenery's (down and right on the map)
    const sh = this.p2;
    if (project(this.cam, b.x + 2, b.y + 3, sh, 4)) {
      const qs = Math.max(0.42, CHASE.height / sh.depth);
      s.shadow.setVisible(true).setFrame(frame).setPosition(sh.sx, sh.sy).setScale(sh.scale, sh.scale * qs).setAlpha(0.32 * fade).setDepth(base - 0.004);
    } else s.shadow.setVisible(false);

    if (s.cone) {
      // headlight pool: a flat glow on the road in front of the car
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const ax = b.x + cos * 9;
      const ay = b.y + sin * 9;
      const near = this.p2;
      const far = this.p3;
      if (project(this.cam, ax, ay, near, 4) && project(this.cam, ax + cos * 48, ay + sin * 48, far, 4)) {
        const dx = far.sx - near.sx;
        const dy = far.sy - near.sy;
        const ang = Math.atan2(dy, dx);
        const kMid = (near.scale + far.scale) / 2;
        const qMid = CHASE.height / ((near.depth + far.depth) / 2);
        // the cone's width is foreshortened when it points across the screen
        const across = kMid * Math.sqrt(Math.sin(ang) ** 2 + (qMid * Math.cos(ang)) ** 2);
        s.cone.setVisible(true).setPosition(near.sx, near.sy).setRotation(ang).setScale(Math.hypot(dx, dy) / 48, across);
        s.cone.setAlpha(0.2 * fade).setDepth(base - 0.005);
      } else s.cone.setVisible(false);
    }
  }

  private drawBits(dt: number): void {
    const p = this.p;
    for (const bit of this.bits) {
      if (bit.life <= 0) {
        if (bit.img.visible) bit.img.setVisible(false);
        continue;
      }
      bit.life -= dt;
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      bit.vz -= bit.gravity * dt;
      bit.z = Math.max(0, bit.z + bit.vz * dt);
      if (bit.life <= 0 || !project(this.cam, bit.x, bit.y, p, 8) || p.depth > 900) {
        bit.img.setVisible(false);
        continue;
      }
      const t = 1 - bit.life / bit.total;
      const size = (bit.size0 + (bit.size1 - bit.size0) * t) * p.scale;
      bit.img.setVisible(true).setPosition(p.sx, p.sy - bit.z * p.scale).setScale(size).setAlpha(bit.alpha * (1 - t)).setDepth(-p.depth + 0.01);
    }
  }
}

