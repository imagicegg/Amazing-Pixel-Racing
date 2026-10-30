// The CHASE view in real 3D: three.js draws the track, scenery and voxel cars
// from a camera behind and above your car, at the game's own 480x270
// resolution so everything stays pixelated. Phaser shows the result as a
// texture under the HUD.
//
// Like the software view before it, the camera never rolls: it looks level at
// the horizon and turns only by yawing, which keeps the view comfortable.
import Phaser from 'phaser';
import * as THREE from 'three';
import { GAME_H, GAME_W, UI } from '../config.ts';
import { carShape, carVoxels, wheelVoxels, type CarShape } from '../art/car3d.ts';
import { meshVoxels, type MeshData } from '../art/voxel.ts';
import { coneRaster } from '../art/sprites.ts';
import type { CarDesign } from '../art/cars.ts';
import { buildPanorama } from '../tracks/sky.ts';
import type { LoadedTrack } from '../tracks/trackCache.ts';
import type { Theme } from '../tracks/themes.ts';
import type { Race } from '../game/race.ts';
import { DEBRIS } from '../art/itemArt.ts';
import { hex, toRGBInt } from '../art/raster.ts';
import { forwardSpeed } from '../game/physics.ts';
import { CHASE, HeightFollow, SEE_THROUGH, YawFollow, type CarPose, type EffectKind } from '../game/chaseRig.ts';
import { WALL_THICKNESS, gradeAt, heightAt } from '../tracks/geometry.ts';
import { terrainAt } from '../tracks/terrain.ts';
import { CHUNK, rasterTexture, rgb, worldFor, type World3D } from './World3D.ts';
import { Items3D } from './Items3D.ts';

// Colours are used exactly as drawn (sRGB numbers straight through), like the
// pixel art everywhere else in the game.
THREE.ColorManagement.enabled = false;

/** Where the sun shines from (towards it): high in the north-west, like the overhead view's shadows. */
const SUN = new THREE.Vector3(-0.55, 0.8, -0.35).normalize();
/** Half-size of the area round the view that gets shadows, in world px. */
const SHADOW_REACH = 420;
/**
 * Quality steps, tried in order when the view runs slowly: scenery switches
 * to half-resolution models beyond `detail` px from the camera and is not
 * drawn beyond `draw`.
 */
const QUALITY = [
  { shadows: true, detail: 520, draw: 1700 },
  { shadows: false, detail: 360, draw: 1400 },
  { shadows: false, detail: 260, draw: 1100 },
];
/** Below this frame rate (sustained), drop a quality step for the rest of the session. */
const MIN_FPS = 45;
let quality = 0;

let sharedRenderer: THREE.WebGLRenderer | null = null;

/** One renderer for the whole session: browsers allow only a few WebGL contexts. */
function getRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    const canvas = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(GAME_W, GAME_H, false);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.shadowMap.enabled = true;
    // hard-edged shadows suit the pixel art
    r.shadowMap.type = THREE.BasicShadowMap;
    sharedRenderer = r;
  }
  return sharedRenderer;
}

/** Full-screen sky: samples the 360-degree panorama by viewing angle, so it pans exactly with the ground. */
function skyMaterial(pano: THREE.Texture, panoRows: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      pano: { value: pano },
      yaw: { value: 0 },
      focal: { value: CHASE.focal },
      horizon: { value: panoRows },
      screen: { value: new THREE.Vector2(GAME_W, GAME_H) },
    },
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D pano;
      uniform float yaw;
      uniform float focal;
      uniform float horizon;
      uniform vec2 screen;
      void main() {
        float row = screen.y - gl_FragCoord.y;
        float angle = yaw + atan((gl_FragCoord.x - screen.x * 0.5) / focal);
        float u = fract(angle / 6.28318530718);
        float v = (min(row, horizon - 0.5)) / horizon;
        gl_FragColor = texture2D(pano, vec2(u, v));
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Car voxel mesh -> geometry. Car grids are laid out like the sprites (x =
 * column, z = row with the nose at 0); `place` maps a grid point to model
 * space, where the nose points along +x and the car's right is +z.
 */
function carGeometry(m: MeshData, place: (x: number, y: number, z: number) => [number, number, number]): THREE.BufferGeometry {
  const pos = new Float32Array(m.positions.length);
  const nrm = new Float32Array(m.normals.length);
  for (let i = 0; i < pos.length; i += 3) {
    pos.set(place(m.positions[i], m.positions[i + 1], m.positions[i + 2]), i);
    nrm[i] = -m.normals[i + 2];
    nrm[i + 1] = m.normals[i + 1];
    nrm[i + 2] = m.normals[i];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

interface Car3D {
  root: THREE.Group;
  /** Bounces and hops, and leans the car along the slope it is on. */
  lift: THREE.Group;
  /** Nose up (+) or down along the road or the flight path, radians, smoothed. */
  pitch: number;
  /** Eyes ahead, left, right, and blinking. */
  bodies: THREE.Mesh[];
  wheels: { pivot: THREE.Group; mesh: THREE.Mesh; front: boolean; radius: number }[];
  material: THREE.MeshLambertMaterial;
  spin: number;
  blinkIn: number;
}

/** Little square particles with height, speed and gravity, drawn as points. */
class Bits {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly total: Float32Array;
  private readonly gravity: Float32Array;
  private readonly tint: Float32Array;
  /** Height of the ground each particle came off: it never sinks below it. */
  private readonly floor: Float32Array;
  private readonly count: number;
  private next = 0;

  constructor(size: number, additive: boolean, count = 160) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.total = new Float32Array(count).fill(1);
    this.gravity = new Float32Array(count);
    this.tint = new Float32Array(count * 3);
    this.floor = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const mat = new THREE.PointsMaterial({
      // three.js scales points by half the canvas height; our lens is longer than that
      size: size * (CHASE.focal / (GAME_H / 2)),
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** `y` is the height above the ground at `base`. */
  emit(x: number, y: number, z: number, speed: [number, number], rise: [number, number], life: number, gravity: number, colour: number, base = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    const dir = Math.random() * Math.PI * 2;
    const v = speed[0] + Math.random() * (speed[1] - speed[0]);
    this.pos.set([x, base + y, z], i * 3);
    this.floor[i] = base + 0.5;
    this.vel.set([Math.cos(dir) * v, rise[0] + Math.random() * (rise[1] - rise[0]), Math.sin(dir) * v], i * 3);
    this.life[i] = life;
    this.total[i] = life;
    this.gravity[i] = gravity;
    this.tint.set([((colour >> 16) & 0xff) / 255, ((colour >> 8) & 0xff) / 255, (colour & 0xff) / 255], i * 3);
  }

  update(dt: number, alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= this.gravity[i] * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] = Math.max(this.floor[i], this.pos[o + 1] + this.vel[o + 1] * dt);
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const t = Math.max(0, this.life[i] / this.total[i]);
      this.col.set([this.tint[o], this.tint[o + 1], this.tint[o + 2], alpha * t], i * 4);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

const pick = (list: number[]) => list[Math.floor(Math.random() * list.length)];

export class ChaseView3D {
  readonly layer: Phaser.GameObjects.Layer;
  private readonly race: Race;
  private readonly theme: Theme;
  private readonly terrain: LoadedTrack['terrain'];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly tex: Phaser.Textures.Texture;
  private readonly scene3: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: THREE.ShaderMaterial;
  private readonly sun: THREE.DirectionalLight;
  private readonly world: World3D;
  private readonly follow = new YawFollow();
  /** The camera rides along the road's height, smoothed. */
  private readonly rise = new HeightFollow();
  /** How see-through the bridges are (0 solid, 1 most), while you drive under one. */
  private bridgeFade = 0;
  private readonly cars: Car3D[] = [];
  private readonly dust: Bits;
  private readonly smoke: Bits;
  private readonly sparks: Bits;
  private readonly flames: Bits;
  /** Coins, pickups, obstacles, missiles, shields and dizzy stars. */
  private readonly items: Items3D;
  /** Running time, for the items' animations. */
  private time = 0;
  private readonly skidRGB: [number, number, number];
  /** Puddle colours (0xRRGGBB), for splashes. */
  private readonly splash: number[];
  private skidsPending = false;
  private skidFlushIn = 0;
  /** Frame timing, to notice a device that can't keep up. */
  private perfTime = 0;
  private perfFrames = 0;
  private slowWindows = 0;
  /** Everything made for this race, released when it ends (the world itself is kept per track). */
  private readonly disposables: { dispose(): void }[] = [];

  constructor(scene: Phaser.Scene, track: LoadedTrack, race: Race, theme: Theme) {
    this.race = race;
    this.theme = theme;
    this.terrain = track.terrain;
    // first, so a missing WebGL fails before anything is added to the scene
    this.renderer = getRenderer();
    const key = 'chase-3d';
    if (!scene.textures.exists(key)) scene.textures.create(key, this.renderer.domElement, GAME_W, GAME_H)!.add('__BASE', 0, 0, 0, GAME_W, GAME_H);
    this.tex = scene.textures.get(key);
    // under every HUD object (the world camera never draws this layer)
    this.layer = scene.add.layer().setDepth(-1);
    this.layer.add(scene.add.image(0, 0, key).setOrigin(0, 0));

    const s = new THREE.Scene();
    this.scene3 = s;
    const def = race.geom.def;
    const pano = buildPanorama(def.theme, Math.round(Math.PI * 2 * CHASE.focal), CHASE.horizon, def.seed);
    s.fog = new THREE.Fog(rgb(pano.haze), CHASE.fogStart, CHASE.fogEnd);
    s.background = new THREE.Color(rgb(pano.haze));

    // A level camera whose lens is shifted down, so the horizon sits at row
    // 60 and upright things stay upright: the same projection as the
    // software view. The "full" frame is centred on the horizon.
    const fullH = 2 * (GAME_H - CHASE.horizon);
    const fov = (2 * Math.atan(fullH / 2 / CHASE.focal) * 180) / Math.PI;
    this.camera = new THREE.PerspectiveCamera(fov, GAME_W / fullH, 4, 6000);
    this.camera.setViewOffset(GAME_W, fullH, 0, fullH / 2 - CHASE.horizon, GAME_W, GAME_H);

    const panoTex = this.own(new THREE.DataTexture(new Uint8Array(pano.raster.px.buffer.slice(0)), pano.raster.w, pano.raster.h));
    panoTex.magFilter = THREE.NearestFilter;
    panoTex.minFilter = THREE.NearestFilter;
    panoTex.wrapS = THREE.RepeatWrapping;
    panoTex.needsUpdate = true;
    this.sky = this.own(skyMaterial(panoTex, pano.raster.h));
    const skyQuad = new THREE.Mesh(this.own(new THREE.PlaneGeometry(2, 2)), this.sky);
    skyQuad.frustumCulled = false;
    skyQuad.renderOrder = -1000;
    s.add(skyQuad);

    const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.world = worldFor(track, theme, anisotropy);
    s.add(this.world.group);

    // Sky light plus sun on a face pointing straight up adds up to exactly 1,
    // so the painted ground and every top face show their colours as drawn.
    // Night has a weaker "sun" (the moon), so sides and shadows are darker.
    const ambient = theme.night ? 0.7 : 0.62;
    s.add(new THREE.AmbientLight(0xffffff, ambient * Math.PI));
    this.sun = new THREE.DirectionalLight(0xffffff, ((1 - ambient) / SUN.y) * Math.PI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_REACH;
    sc.right = SHADOW_REACH;
    sc.top = SHADOW_REACH;
    sc.bottom = -SHADOW_REACH;
    sc.near = 10;
    sc.far = 2000;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    s.add(this.sun);
    s.add(this.sun.target);

    const cone = theme.night ? this.own(rasterTexture(coneRaster(), anisotropy)) : null;
    for (const racer of race.racers) {
      const car = this.buildCar(racer.design, racer.alt);
      if (cone) {
        // headlights: a soft pool of light on the road ahead
        const pool = new THREE.Mesh(
          this.own(new THREE.PlaneGeometry(48, 30)),
          this.own(new THREE.MeshBasicMaterial({ map: cone, color: 0xfff3c4, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(9 + 24, 0.4, 0);
        car.root.add(pool);
      }
      s.add(car.root);
      this.cars.push(car);
    }

    this.dust = this.own(new Bits(3, false));
    this.smoke = this.own(new Bits(4, false, 240));
    this.sparks = this.own(new Bits(2, true));
    this.flames = this.own(new Bits(3, true));
    for (const b of [this.dust, this.smoke, this.sparks, this.flames]) s.add(b.points);
    this.items = this.own(new Items3D(race));
    s.add(this.items.group);
    const skid = theme.skid;
    this.skidRGB = [(skid >> 16) & 0xff, (skid >> 8) & 0xff, skid & 0xff];
    this.splash = theme.puddle.colors.map((c) => toRGBInt(hex(c)));
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  /** A voxel car made from the car's own pixel art (so painted cars work too). */
  private buildCar(design: CarDesign, alt: boolean): Car3D {
    const shape: CarShape = carShape(design.top);
    const rc = shape.rows / 2;
    const cc = shape.cols / 2;
    const material = this.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const root = new THREE.Group();
    const lift = new THREE.Group();
    root.add(lift);
    const variants: [number, boolean][] = [
      [0, false],
      [1, false],
      [2, false],
      [0, true],
    ];
    const bodies = variants.map(([look, blink], i) => {
      const geo = this.own(carGeometry(meshVoxels(carVoxels(design, alt, look, blink, shape)), (x, y, z) => [rc - z, y, x - cc]));
      const mesh = new THREE.Mesh(geo, material);
      mesh.visible = i === 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      lift.add(mesh);
      return mesh;
    });
    const wheels = shape.wheels.map((wh) => {
      const r = wh.diameter / 2;
      // centred on the axle, so it can spin
      const geo = this.own(carGeometry(meshVoxels(wheelVoxels(design, alt, wh)), (x, y, z) => [r - z, y - r, x - wh.width / 2]));
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      const pivot = new THREE.Group();
      pivot.position.set(rc - wh.y, r, wh.x - cc);
      pivot.add(mesh);
      lift.add(pivot);
      return { pivot, mesh, front: wh.front, radius: r };
    });
    return { root, lift, pitch: 0, bodies, wheels, material, spin: 0, blinkIn: 1 + Math.random() * 3 };
  }

  setVisible(on: boolean): void {
    this.layer.setVisible(on);
  }

  /** Jumps straight behind the car (when the view is switched on). */
  snap(): void {
    this.follow.snap(this.race.player.body);
    this.rise.snap(this.race.player.ground);
  }

  /** Paints a tyre mark into the ground texture; uploads are batched a few times a second. */
  skid(x: number, y: number): void {
    const tex = this.world.ground;
    const img = tex.image as { data: Uint8Array; width: number; height: number };
    const x0 = Math.round(x) - 1;
    const y0 = Math.round(y) - 1;
    if (x0 < 0 || y0 < 0 || x0 + 2 > img.width || y0 + 2 > img.height) return;
    const [r, g, b] = this.skidRGB;
    for (let j = 0; j < 2; j++) {
      const o = ((y0 + j) * img.width + x0) * 4;
      for (let i = 0; i < 8; i += 4) {
        img.data[o + i] += (r - img.data[o + i]) * 0.4;
        img.data[o + i + 1] += (g - img.data[o + i + 1]) * 0.4;
        img.data[o + i + 2] += (b - img.data[o + i + 2]) * 0.4;
      }
      tex.addUpdateRange(o, 8);
    }
    this.skidsPending = true;
    this.world.marked = true;
  }

  /** `z` is the height of the ground (or road, or deck) the effect starts from; by default the land's. */
  emit(kind: EffectKind, x: number, y: number, count: number, z = terrainAt(this.terrain, x, y)): void {
    for (let n = 0; n < count; n++) {
      if (kind === 'dust') this.dust.emit(x, 1, y, [6, 24], [6, 16], 0.5, 0, this.theme.dust, z);
      else if (kind === 'sparks') this.sparks.emit(x, 3, y, [40, 110], [20, 60], 0.28, 260, pick([UI.yellow, UI.white, UI.orange]), z);
      else if (kind === 'smoke') this.smoke.emit(x, 1.5, y, [4, 14], [4, 12], 0.75, 0, pick([0xf4f4f4, 0xd8dce8, 0xc2c8d6]), z);
      else if (kind === 'nitro') this.flames.emit(x, 3, y, [10, 40], [2, 8], 0.22, 0, pick([UI.cyan, UI.sky, UI.white, 0x9f7fff]), z);
      else if (kind === 'gold') this.sparks.emit(x, 5, y, [20, 60], [20, 50], 0.45, 120, pick([UI.yellow, 0xfff3a0, UI.white]), z);
      else if (kind === 'debris') this.dust.emit(x, 3, y, [30, 90], [30, 70], 0.6, 260, pick(DEBRIS[this.theme.obstacle]), z);
      else if (kind === 'splash') this.dust.emit(x, 1, y, [10, 40], [10, 30], 0.45, 120, pick(this.splash), z);
      else this.flames.emit(x, 3, y, [10, 40], [2, 10], 0.24, 0, pick([UI.yellow, UI.orange, UI.red]), z);
    }
  }

  update(dt: number, poses: readonly CarPose[]): void {
    const player = this.race.player;
    const b = player.body;
    const yaw = this.follow.step(b, dt);
    const fx = Math.cos(yaw);
    const fz = Math.sin(yaw);
    const cam = this.camera;
    // level, at the road's height (not the car's: a jump doesn't lift the view)
    const ground = this.rise.step(player.ground, dt);
    cam.position.set(b.x - fx * CHASE.behind, ground + CHASE.height, b.y - fz * CHASE.behind);
    cam.lookAt(cam.position.x + fx, cam.position.y, cam.position.z + fz);
    this.sky.uniforms.yaw.value = yaw;
    // distance to (roughly) the nearest point of each chunk
    this.watchSpeed(dt);
    const q = QUALITY[quality];
    this.sun.castShadow = q.shadows;
    const reach = CHUNK * 0.7;
    for (const c of this.world.chunks) {
      const d = Math.hypot(c.x - cam.position.x, c.z - cam.position.z) - reach;
      const near = d < q.detail;
      const shown = d < q.draw;
      for (const m of c.near) m.visible = near;
      for (const m of c.far) m.visible = shown && !near;
      for (const m of c.always) m.visible = shown;
    }
    this.placeSun(b.x + fx * (SHADOW_REACH - 120), ground, b.y + fz * (SHADOW_REACH - 120));
    this.fadeBridges(dt);

    for (const r of this.race.racers) {
      const car = this.cars[r.index];
      const pose = poses[r.index];
      const body = r.body;
      car.root.position.set(body.x, body.z, body.y);
      // models face +x; three.js turns counter-clockwise seen from above
      car.root.rotation.y = -body.angle;
      car.lift.position.y = -pose.bob * 0.5;
      // nose up the slope; in the air, partly along the flight path
      const g = this.race.geom;
      const along = Math.cos(body.angle) * g.tx[r.seg] + Math.sin(body.angle) * g.ty[r.seg];
      const lean = body.air > 0 ? 0.6 * Math.atan2(body.vz, Math.max(40, Math.hypot(body.vx, body.vy))) : Math.atan(gradeAt(g, r.probe.s) * along);
      car.pitch += (Math.max(-0.45, Math.min(0.45, lean)) - car.pitch) * Math.min(1, dt * 12);
      car.lift.rotation.z = car.pitch;
      // blink now and then
      car.blinkIn -= dt;
      if (car.blinkIn < -0.12) car.blinkIn = 2 + Math.random() * 3;
      const variant = car.blinkIn < 0 ? 3 : pose.look;
      car.bodies.forEach((m, i) => (m.visible = i === variant));
      car.spin += forwardSpeed(body) * dt;
      for (const w of car.wheels) {
        w.mesh.rotation.z = -car.spin / w.radius;
        if (w.front) w.pivot.rotation.y = -body.steer * 0.45;
      }
      // a rival between the camera and you turns see-through, and so does a car
      // just back from a missile hit, while it can't be knocked out again
      const depth = (body.x - cam.position.x) * fx + (body.y - cam.position.z) * fz;
      const ghost = (!r.isPlayer && depth < CHASE.behind - SEE_THROUGH) || (r.immune > 0 && body.stun <= 0);
      if (car.material.transparent !== ghost) {
        car.material.transparent = ghost;
        car.material.opacity = ghost ? 0.5 : 1;
        car.material.depthWrite = !ghost;
      }
    }

    this.time += dt;
    this.items.update(this.time);
    this.dust.update(dt, 0.8);
    this.smoke.update(dt, 0.55);
    this.sparks.update(dt, 1);
    this.flames.update(dt, 0.9);

    if (this.skidsPending) {
      this.skidFlushIn -= dt;
      if (this.skidFlushIn <= 0) {
        this.world.ground.needsUpdate = true;
        this.skidsPending = false;
        this.skidFlushIn = 0.12;
      }
    }

    this.renderer.render(this.scene3, cam);
    this.tex.source[0].update();
  }

  /** Steps the quality down when frames take too long for a few seconds running. */
  private watchSpeed(dt: number): void {
    // ignore hiccups such as a tab coming back to the front
    if (dt <= 0 || dt >= 0.1 || quality >= QUALITY.length - 1) return;
    this.perfTime += dt;
    this.perfFrames++;
    if (this.perfTime < 2) return;
    const slow = this.perfTime / this.perfFrames > 1 / MIN_FPS;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    this.perfTime = 0;
    this.perfFrames = 0;
    if (this.slowWindows >= 2) {
      quality++;
      this.slowWindows = 0;
    }
  }

  /**
   * While your car is under a bridge (or just past it, with the camera
   * behind still looking through it) the bridges turn see-through, fading
   * in and out over a moment, so the deck never hides you.
   */
  private fadeBridges(dt: number): void {
    const r = this.race.player;
    const g = this.race.geom;
    const b = r.body;
    const edge = g.wallDist + WALL_THICKNESS + 10;
    let under = false;
    const yaw = this.follow.yaw;
    for (const br of this.world.bridges) {
      const d = br.span;
      // where the car is, and on the way back to the camera
      for (const back of [0, 40, 80]) {
        const x = Math.floor(b.x - Math.cos(yaw) * back) - d.x0;
        const y = Math.floor(b.y - Math.sin(yaw) * back) - d.y0;
        if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
        const k = d.seg[y * d.w + x];
        if (k < 0 || d.dist2[y * d.w + x] > edge * edge) continue;
        if (heightAt(g, k * g.ds) - b.z > 12) under = true;
      }
    }
    const target = under ? 1 : 0;
    const before = this.bridgeFade;
    this.bridgeFade += Math.sign(target - before) * Math.min(Math.abs(target - before), dt * 5);
    if (this.bridgeFade === before && dt > 0) return;
    const f = this.bridgeFade;
    for (const br of this.world.bridges) {
      for (const m of br.materials) {
        m.transparent = f > 0;
        m.opacity = 1 - 0.7 * f;
        m.depthWrite = f === 0;
      }
    }
  }

  /**
   * Keeps the sun's shadow box over the part of the track in view. It moves
   * in whole shadow-map texels, so shadow edges don't shimmer as you drive.
   */
  private placeSun(x: number, y: number, z: number): void {
    const texel = (SHADOW_REACH * 2) / this.sun.shadow.mapSize.x;
    const right = new THREE.Vector3(0, 1, 0).cross(SUN).normalize();
    const up = SUN.clone().cross(right);
    const centre = new THREE.Vector3(x, y, z);
    const u = Math.round(centre.dot(right) / texel) * texel;
    const v = Math.round(centre.dot(up) / texel) * texel;
    const w = centre.dot(SUN);
    centre.copy(right).multiplyScalar(u).addScaledVector(up, v).addScaledVector(SUN, w);
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(SUN, 900);
    this.sun.target.updateMatrixWorld();
  }

  destroy(): void {
    this.scene3.remove(this.world.group);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
