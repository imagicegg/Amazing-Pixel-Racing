import Phaser from 'phaser';
import { GAME_H, GAME_W, PHYSICS_DT, UI, formatTime, ordinal } from '../config.ts';
import { TRACKS } from '../tracks/tracks.ts';
import { THEMES, type Theme } from '../tracks/themes.ts';
import { loadTrack, propKey, type LoadedTrack } from '../tracks/trackCache.ts';
import { buildMinimap, type Minimap } from '../tracks/minimap.ts';
import { DRIFT_CHAIN, Race, type Racer } from '../game/race.ts';
import { RaceInput } from '../game/input.ts';
import { sfx } from '../game/audio.ts';
import { slipSpeed, speedOf } from '../game/physics.ts';
import { WALL_THICKNESS, heightAt } from '../tracks/geometry.ts';
import { getDifficulty, getView, rememberChoice, setView, submitResult, type ViewMode } from '../game/save.ts';
import type { Difficulty } from '../game/difficulty.ts';
import { findCar } from '../game/customCars.ts';
import { CAR_DESIGNS } from '../art/cars.ts';
import { LOOK_AHEAD, LOOK_LEFT, LOOK_RIGHT, carPalette, directionFrame } from '../art/sprites.ts';
import { hex, toRGBInt } from '../art/raster.ts';
import { addRaster, carFrame, carKey, panelKey } from '../ui/textures.ts';
import { button, firstPad, goTo, label, panel, toggleMute, type Button } from '../ui/ui.ts';
import { ChaseView } from './ChaseView.ts';
import { ChaseView3D } from './ChaseView3D.ts';
import { ItemSprites } from './ItemSprites.ts';
import type { CarPose, EffectKind } from '../game/chaseRig.ts';
import { ITEM_KINDS, MAX_COINS, type ItemKind } from '../game/items.ts';
import { DEBRIS } from '../art/itemArt.ts';

const PAUSE_ITEMS = 4;

/** 12345 -> "12,345" */
function points(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Depths in the overhead view: a car on a bridge deck is drawn above the deck, which is above the cars passing under it. */
const DEPTH = { car: 4, shadow: 3, deck: 4.5, deckShadow: 4.55, deckCar: 4.6 };

/** Overhead sprites of one car, plus how it looks this frame (shared with the chase view). */
interface CarView extends CarPose {
  car: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Sprite;
  cone: Phaser.GameObjects.Image | null;
  hop: number;
  color: number;
}

export interface Standing {
  name: string;
  design: string;
  alt: boolean;
  isPlayer: boolean;
  time: number;
  bestLap: number;
  finished: boolean;
}

export interface RaceResultData {
  car: string;
  track: string;
  difficulty: Difficulty;
  standings: Standing[];
  playerPlace: number;
  playerTime: number;
  bestLap: number;
  records: { race: boolean; lap: boolean };
}

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

export class RaceScene extends Phaser.Scene {
  private carId = 'zippy';
  private trackId = 'meadow';
  private race!: Race;
  private theme!: Theme;
  private views: CarView[] = [];
  private controls!: RaceInput;
  private acc = 0;
  private phase: 'countdown' | 'racing' | 'done' = 'countdown';
  private clock = 0;
  private finishTimer = 0;
  private lastCount = -1;
  private paused = false;
  private pauseUi: { root: Phaser.GameObjects.Container; items: Phaser.GameObjects.BitmapText[]; index: number } | null = null;
  private menuKeys!: Record<'UP' | 'DOWN' | 'W' | 'S' | 'ENTER' | 'SPACE' | 'M', Phaser.Input.Keyboard.Key>;
  private skids!: Phaser.GameObjects.RenderTexture;
  private skidDirty = false;
  private fx!: Record<EffectKind, Emitter>;
  /** HUD effect: falls over the screen, not the track. */
  private confetti!: Emitter;
  private camX = 0;
  private camY = 0;
  private lookX = 0;
  private lookY = 0;
  /** 'top' is the overhead map view; 'chase' is the 3D view from behind your car. */
  private view: ViewMode = 'top';
  private track!: LoadedTrack;
  /** Built the first time the chase view is shown. */
  private chase: ChaseView3D | ChaseView | null = null;
  /** Second camera: draws the HUD and the chase view. The main camera draws the overhead world. */
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private viewBtn!: Button;
  private viewNote!: Phaser.GameObjects.BitmapText;
  /** Puts your car back on the track (also the R key). Works only while racing. */
  private resetBtn!: Button;
  /** Seconds your car has been nearly stopped off the road (the HUD then suggests the reset). */
  private stuck = 0;
  /** Coins, pickups, obstacles and missiles in the overhead view. */
  private itemSprites!: ItemSprites;
  /** Item boxes clicked or tapped: use those items on the next frame. */
  private readonly taps: Record<ItemKind, boolean> = { missile: false, shield: false };
  /** Seconds to the next warning beep while a missile is coming for you. */
  private warnIn = 0;
  /** The bridge decks in the overhead view, and how see-through they are while you drive under one. */
  private decks: Phaser.GameObjects.Image[] = [];
  private deckFade = 0;
  private map!: Minimap;
  private hud!: {
    lap: Phaser.GameObjects.BitmapText;
    lapTime: Phaser.GameObjects.BitmapText;
    pos: Phaser.GameObjects.BitmapText;
    total: Phaser.GameObjects.BitmapText;
    time: Phaser.GameObjects.BitmapText;
    speed: Phaser.GameObjects.BitmapText;
    gauge: Phaser.GameObjects.Graphics;
    dots: Phaser.GameObjects.Graphics;
    mapX: number;
    mapY: number;
    msg: Phaser.GameObjects.BitmapText;
    sub: Phaser.GameObjects.BitmapText;
    lights: Phaser.GameObjects.Image[];
    lightPanel: Phaser.GameObjects.Image;
    wrong: Phaser.GameObjects.BitmapText;
    /** Under the wrong-way warning (or when stuck): how to reset. */
    resetHint: Phaser.GameObjects.BitmapText;
    /** The two item boxes (missile, shield), each with its icon and key, and the coins carried. */
    slots: Record<ItemKind, { icon: Phaser.GameObjects.Image; key: Phaser.GameObjects.BitmapText }>;
    coins: Phaser.GameObjects.BitmapText;
    /** Shown while a missile is coming for you. */
    missileWarn: Phaser.GameObjects.BitmapText;
    /** Shown for a moment when your missile had no car ahead to aim at. */
    noTarget: Phaser.GameObjects.BitmapText;
    /** After the finish: how to go straight to the results. */
    continueHint: Phaser.GameObjects.BitmapText;
    nitroLabel: Phaser.GameObjects.BitmapText;
    nitroReady: Phaser.GameObjects.BitmapText;
    nitroBar: Phaser.GameObjects.Graphics;
    nitroX: number;
    driftTitle: Phaser.GameObjects.BitmapText;
    driftPoints: Phaser.GameObjects.BitmapText;
    driftCombo: Phaser.GameObjects.BitmapText;
    driftBar: Phaser.GameObjects.Graphics;
  };
  /** The drift score popup is showing a result (banked or crashed) rather than a live combo. */
  private driftResult = false;
  /** Gamepad A was down last frame (to skip to the results on a fresh press). */
  private padConfirmHeld = true;

  constructor() {
    super('race');
  }

  init(data: { car?: string; track?: string }): void {
    this.carId = data.car ?? 'zippy';
    this.trackId = data.track ?? 'meadow';
    this.views = [];
    this.acc = 0;
    this.phase = 'countdown';
    this.clock = 0;
    this.finishTimer = 0;
    this.lastCount = -1;
    this.paused = false;
    this.pauseUi = null;
    this.driftResult = false;
    this.padConfirmHeld = true;
    this.stuck = 0;
    this.taps.missile = false;
    this.taps.shield = false;
    this.warnIn = 0;
    this.decks = [];
    this.deckFade = 0;
    this.view = getView();
    this.chase = null;
  }

  create(): void {
    const def = TRACKS.find((t) => t.id === this.trackId) ?? TRACKS[0];
    const track = loadTrack(this, def);
    this.track = track;
    const g = track.geom;
    const car = findCar(this.carId) ?? CAR_DESIGNS[0];
    this.carId = car.id;
    this.race = new Race(g, car, getDifficulty());
    this.theme = THEMES[def.theme];
    rememberChoice(this.carId, this.trackId);

    const cam = this.cameras.main;
    cam.setBackgroundColor(this.theme.backdrop);
    this.add.image(0, 0, track.key).setOrigin(0, 0).setDepth(0);
    this.skids = this.add.renderTexture(0, 0, g.width, g.height).setOrigin(0, 0).setDepth(1);

    // boost pads shimmer
    for (const pad of def.boostPads) {
      const s = pad.at * g.length;
      const i = Math.floor(s / g.ds) % g.n;
      const x = g.x[i] - g.ty[i] * pad.lateral;
      const y = g.y[i] + g.tx[i] * pad.lateral;
      const glow = this.add.image(x, y, 'glow').setDepth(2).setScale(1.1, 0.8).setRotation(Math.atan2(g.ty[i], g.tx[i]));
      glow.setTint(this.theme.night ? UI.cyan : UI.yellow).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.15);
      this.tweens.add({ targets: glow, alpha: 0.45, duration: 420, yoyo: true, repeat: -1 });
    }
    if (this.theme.night) {
      for (const l of track.lamps) {
        this.add.image(l.x, l.y, 'glow').setDepth(6).setScale(2.6).setTint(0xffe9a8).setAlpha(0.13).setBlendMode(Phaser.BlendModes.ADD);
      }
    }

    // trees, cacti, lamp posts... are sprites, not paint, so the chase view can stand them up
    for (const pr of track.props) this.add.image(pr.x, pr.y, propKey(this, pr.name)).setOrigin(0, 0).setDepth(3.5);
    // bridge decks pass over the cars below them
    this.decks = track.decks.map((d, k) => this.add.image(d.x, d.y, track.deckKeys[k]).setOrigin(0, 0).setDepth(DEPTH.deck));

    for (const r of this.race.racers) {
      const key = carKey(r.design, r.alt);
      const frame = carFrame(directionFrame(r.body.angle), LOOK_AHEAD);
      const shadow = this.add.sprite(r.body.x, r.body.y, key, frame).setDepth(DEPTH.shadow).setAlpha(0.32);
      shadow.setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
      const car = this.add.sprite(r.body.x, r.body.y, key, frame).setDepth(4);
      let cone: Phaser.GameObjects.Image | null = null;
      if (this.theme.night) {
        cone = this.add.image(r.body.x, r.body.y, 'cone').setOrigin(0, 0.5).setDepth(5);
        cone.setTint(0xfff3c4).setAlpha(0.2).setBlendMode(Phaser.BlendModes.ADD);
      }
      const color = toRGBInt(hex(carPalette(r.design, r.alt).B));
      this.views.push({ car, shadow, cone, hop: 0, color, look: LOOK_AHEAD, bob: 0 });
    }

    const particles = (texture: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number) =>
      this.add.particles(0, 0, texture, { emitting: false, ...cfg }).setDepth(depth);
    this.fx = {
      dust: particles('puff', { lifespan: 500, speed: { min: 6, max: 24 }, alpha: { start: 0.8, end: 0 }, tint: this.theme.dust }, 5),
      sparks: particles('dot', { lifespan: 280, speed: { min: 40, max: 110 }, alpha: { start: 1, end: 0 }, tint: [UI.yellow, UI.white, UI.orange], blendMode: 'ADD' }, 7),
      smoke: particles('puff', { lifespan: 700, speed: { min: 4, max: 16 }, alpha: { start: 0.55, end: 0 }, scale: { start: 1, end: 2.6 }, tint: [0xf4f4f4, 0xd8dce8, 0xc2c8d6] }, 3.8),
      nitro: particles('puff', { lifespan: 220, speed: { min: 10, max: 40 }, alpha: { start: 0.95, end: 0 }, scale: { start: 1.1, end: 0.3 }, tint: [UI.cyan, UI.sky, UI.white, 0x9f7fff], blendMode: 'ADD' }, 3),
      flame: particles('puff', { lifespan: 240, speed: { min: 10, max: 40 }, alpha: { start: 0.9, end: 0 }, scale: { start: 1, end: 0.4 }, tint: [UI.yellow, UI.orange, UI.red], blendMode: 'ADD' }, 3),
      gold: particles('dot', { lifespan: 450, speed: { min: 20, max: 60 }, alpha: { start: 1, end: 0 }, tint: [UI.yellow, 0xfff3a0, UI.white], blendMode: 'ADD' }, 7),
      debris: particles('dot', { lifespan: 550, speed: { min: 30, max: 90 }, alpha: { start: 1, end: 0 }, scale: { start: 1.5, end: 1 }, tint: DEBRIS[this.theme.obstacle] }, 5),
      splash: particles('puff', { lifespan: 420, speed: { min: 10, max: 40 }, alpha: { start: 0.85, end: 0 }, scale: { start: 1, end: 1.8 }, tint: this.theme.puddle.colors.map((c) => toRGBInt(hex(c))) }, 3.9),
    };
    this.itemSprites = new ItemSprites(this, this.race);

    // Everything so far is the overhead world. A second camera draws the HUD
    // and the chase view; the world camera is switched off in the chase view.
    const world = this.children.list.slice();
    this.hudCam = this.cameras.add(0, 0, GAME_W, GAME_H).setRoundPixels(true);
    this.hudCam.ignore(world);
    const firstHud = this.children.list.length;

    this.confetti = particles('dot', { lifespan: 2600, speedY: { min: -40, max: 20 }, speedX: { min: -50, max: 50 }, gravityY: 60, rotate: { min: 0, max: 360 }, tint: [UI.yellow, UI.pink, UI.cyan, UI.lime, UI.orange, UI.white] }, 40);
    this.controls = new RaceInput(this);
    this.menuKeys = this.input.keyboard!.addKeys('UP,DOWN,W,S,ENTER,SPACE,M') as typeof this.menuKeys;
    this.buildHud();
    cam.ignore(this.children.list.slice(firstHud));

    const p = this.race.player.body;
    cam.setRoundPixels(true);
    cam.setBounds(0, 0, g.width, g.height);
    this.camX = p.x;
    this.camY = p.y;
    // start already in place instead of swinging into it
    this.updateCamera(0, true);
    this.setViewMode(this.view, false);

    sfx.music(null);
    sfx.startEngine();
    this.events.once('shutdown', () => {
      sfx.stopEngine();
      if (this.chase instanceof ChaseView3D) this.chase.destroy();
    });
    const onHidden = () => {
      if (!this.paused && this.phase !== 'done') this.togglePause();
    };
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once('shutdown', () => this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden));
    // only the cameras that are drawing: a hidden one's fade would never finish
    for (const c of this.cameras.cameras) if (c.visible) c.fadeIn(250, 26, 28, 44);
    // after the finish, a click or tap anywhere but a button goes straight to the results
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.phase === 'done' && this.finishTimer > 0.8 && over.length === 0) this.showResults();
    });
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  private buildHud(): void {
    const fixed = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T, d = 20) => {
      o.setScrollFactor(0);
      o.setDepth(d);
      return o;
    };
    const race = this.race;
    fixed(panel(this, 4, 4, 82, 30));
    fixed(label(this, 10, 9, 'LAP', { color: UI.grey }), 21);
    const lap = fixed(label(this, 32, 8, `1/${race.laps}`, { scale: 2, color: UI.yellow }), 21);
    const lapTime = fixed(label(this, 10, 22, '0:00.00', { color: UI.white }), 21);

    fixed(panel(this, GAME_W - 86, 4, 82, 30));
    const pos = fixed(label(this, GAME_W - 79, 9, '4TH', { scale: 3, color: UI.yellow }), 21);
    const total = fixed(label(this, GAME_W - 9, 22, `/${race.racers.length}`, { color: UI.grey, originX: 1 }), 21);

    fixed(panel(this, GAME_W / 2 - 34, 4, 68, 16));
    const time = fixed(label(this, GAME_W / 2, 8, '0:00.00', { originX: 0.5 }), 21);

    // speedometer
    const touch = this.controls.hasTouch;
    const spX = touch ? GAME_W / 2 - 40 : 4;
    fixed(panel(this, spX, GAME_H - 30, 80, 26));
    const speed = fixed(label(this, spX + 8, GAME_H - 26, '0', { scale: 2 }), 21);
    fixed(label(this, spX + 72, GAME_H - 24, 'KM/H', { color: UI.grey, originX: 1 }), 21);
    const gauge = fixed(this.add.graphics(), 21);

    // nitro gauge: drifting fills it, C (or the NITRO button) fires it when full
    fixed(panel(this, spX, GAME_H - 47, 80, 15));
    const nitroLabel = fixed(label(this, spX + 6, GAME_H - 43, 'NITRO', { color: UI.grey }), 21);
    const nitroReady = fixed(label(this, spX + 40, GAME_H - 43, touch ? 'NITRO READY' : 'C: NITRO!', { color: UI.yellow, originX: 0.5 }), 21);
    nitroReady.setVisible(false);
    const nitroBar = fixed(this.add.graphics(), 21);

    // drift score: live while you drift, then banked (or lost in a crash)
    const driftTitle = fixed(label(this, GAME_W / 2, 56, '', { color: UI.cyan, originX: 0.5 }), 30);
    const driftPoints = fixed(label(this, GAME_W / 2, 65, '', { scale: 2, color: UI.white, originX: 0.5 }), 30);
    const driftCombo = fixed(label(this, GAME_W / 2, 69, '', { color: UI.yellow }), 30);
    const driftBar = fixed(this.add.graphics(), 30);

    // minimap
    this.map = buildMinimap(race.geom, 96, 64, 2);
    const mapKey = `minimap-${race.geom.def.id}`;
    if (!this.textures.exists(mapKey)) addRaster(this, mapKey, this.map.raster);
    const mapX = touch ? 4 : GAME_W - this.map.raster.w - 6;
    const mapY = touch ? 38 : GAME_H - this.map.raster.h - 6;
    fixed(this.add.image(mapX, mapY, mapKey).setOrigin(0, 0).setAlpha(0.9));
    const dots = fixed(this.add.graphics(), 22);

    const msg = fixed(label(this, GAME_W / 2, GAME_H / 2 - 30, '', { scale: 4, color: UI.yellow, originX: 0.5, originY: 0.5 }), 30);
    const sub = fixed(label(this, GAME_W / 2, GAME_H / 2 + 2, '', { scale: 1, color: UI.white, originX: 0.5, originY: 0.5 }), 30);
    const wrong = fixed(label(this, GAME_W / 2, 52, 'WRONG WAY!', { scale: 2, color: UI.red, originX: 0.5 }), 30).setVisible(false);
    const resetHint = fixed(label(this, GAME_W / 2, 70, '', { color: UI.white, originX: 0.5 }), 30).setVisible(false);

    // A box for each item, so you can carry a missile and a shield together. Click or tap
    // a box to use its item, or press F / G (gamepad LB / d-pad up, MISSILE / SHIELD buttons).
    const slot = (x: number, kind: ItemKind, key: string) => {
      fixed(panel(this, x, 4, 26, 26))
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => (this.taps[kind] = true));
      return {
        icon: fixed(this.add.image(x + 13, 17, kind === 'missile' ? 'item-rocket' : 'item-bubble').setScale(2), 21),
        key: fixed(label(this, x + 22, 21, touch ? '' : key, { color: UI.yellow }), 22).setVisible(false),
      };
    };
    const slots = { missile: slot(90, 'missile', 'F'), shield: slot(118, 'shield', 'G') };
    const noTarget = fixed(label(this, 92, 33, 'NO CAR AHEAD', { color: UI.grey }), 21).setAlpha(0);
    fixed(panel(this, 148, 4, 38, 14));
    fixed(this.add.image(156, 11, 'item-coin', 0), 21);
    const coins = fixed(label(this, 164, 8, '0', { color: UI.white }), 21);
    const missileWarn = fixed(label(this, GAME_W / 2, 24, 'MISSILE!', { color: UI.red, originX: 0.5 }), 30).setVisible(false);
    const continueHint = fixed(label(this, GAME_W / 2, GAME_H / 2 + 16, touch ? 'TAP TO CONTINUE' : 'ENTER  CONTINUE', { color: UI.grey, originX: 0.5 }), 30);
    continueHint.setVisible(false);

    const lightPanel = fixed(this.add.image(GAME_W / 2, 40, panelKey(this, 48, 16, UI.ink, UI.ink)), 25);
    const lights = [0, 1, 2].map((i) => fixed(this.add.image(GAME_W / 2 - 14 + i * 14, 40, 'icon-lightOff'), 26));
    this.hud = {
      lap,
      lapTime,
      pos,
      total,
      time,
      speed,
      gauge,
      dots,
      mapX,
      mapY,
      msg,
      sub,
      lights,
      lightPanel,
      wrong,
      resetHint,
      slots,
      coins,
      missileWarn,
      noTarget,
      continueHint,
      nitroLabel,
      nitroReady,
      nitroBar,
      nitroX: spX + 38,
      driftTitle,
      driftPoints,
      driftCombo,
      driftBar,
    };

    // reset (click, R or gamepad Back) and camera switch (click, V or gamepad Y)
    this.resetBtn = button(this, GAME_W - 86, 37, 14, 14, 'R', () => this.resetCar()).setEnabled(false);
    this.viewBtn = button(this, GAME_W - 70, 37, 66, 14, 'VIEW: TOP', () => this.toggleView());
    this.viewNote = fixed(label(this, GAME_W - 45, 55, '', { color: UI.cyan, originX: 0.5 }), 21).setAlpha(0);
  }

  private toggleView(): void {
    this.setViewMode(this.view === 'top' ? 'chase' : 'top');
  }

  private setViewMode(view: ViewMode, announce = true): void {
    this.view = view;
    setView(view);
    const chase = view === 'chase';
    const cam = this.cameras.main;
    cam.setVisible(!chase);
    // a hidden camera's effects (fades, shakes) stand still, so drop them
    if (chase) cam.resetFX();
    if (chase) {
      const cv = this.chaseView();
      cv.snap();
      // draw it now: while paused, update() won't
      cv.update(0, this.views);
    }
    this.chase?.setVisible(chase);
    this.viewBtn.setText(chase ? 'VIEW: CHASE' : 'VIEW: TOP').setOn(chase);
    if (this.pauseUi) this.selectPause(this.pauseUi.index, true);
    if (!announce) return;
    sfx.blip();
    this.viewNote.setText(chase ? 'BEHIND YOUR CAR' : 'NORTH STAYS UP');
    this.tweens.killTweensOf(this.viewNote);
    this.viewNote.setAlpha(1);
    this.tweens.add({ targets: this.viewNote, alpha: 0, delay: 1200, duration: 300 });
  }

  private chaseView(): ChaseView3D | ChaseView {
    if (!this.chase) {
      try {
        this.chase = new ChaseView3D(this, this.track, this.race, this.theme);
      } catch (err) {
        // three.js needs WebGL; without it, use the software view
        console.warn('3D chase view unavailable, using the software one:', err);
        this.chase = new ChaseView(this, this.track, this.race, this.theme);
      }
      this.cameras.main.ignore(this.chase.layer);
    }
    return this.chase;
  }

  /** Particle effects go to whichever view is showing; `z` is the height they start from in the chase view (the land's by default). */
  private emit(kind: EffectKind, x: number, y: number, count: number, z?: number): void {
    if (this.view === 'chase' && this.chase) this.chase.emit(kind, x, y, count, z);
    else this.fx[kind].emitParticleAt(x, y, count);
  }

  private flash(text: string, sub = '', color: number = UI.yellow, scale = 4, hold = 900): void {
    const { msg, sub: s } = this.hud;
    msg.setText(text).setTint(color).setFontSize(7 * scale).setVisible(true).setAlpha(1);
    s.setText(sub).setVisible(!!sub).setAlpha(1);
    this.tweens.killTweensOf([msg, s]);
    msg.setScale(1.5);
    this.tweens.add({ targets: msg, scale: 1, duration: 260, ease: 'Back.Out' });
    if (hold > 0) this.tweens.add({ targets: [msg, s], alpha: 0, delay: hold, duration: 250 });
  }

  private updateHud(): void {
    const race = this.race;
    const p = race.player;
    const h = this.hud;
    h.lap.setText(`${race.lapOf(p)}/${race.laps}`);
    h.lapTime.setText(formatTime(p.finished ? p.lapTimes[p.lapTimes.length - 1] ?? 0 : race.time - p.lapStart));
    h.pos.setText(ordinal(p.place));
    h.pos.setTint(p.place === 1 ? UI.yellow : p.place === 2 ? UI.white : p.place === 3 ? UI.orange : UI.grey);
    h.time.setText(formatTime(p.finished ? p.finishTime : race.time));
    const spd = speedOf(p.body);
    h.speed.setText(String(Math.round(spd * 0.8)));

    // speed bar
    const touch = this.controls.hasTouch;
    const gx = (touch ? GAME_W / 2 - 40 : 4) + 8;
    const gy = GAME_H - 10;
    h.gauge.clear();
    h.gauge.fillStyle(UI.ink, 1).fillRect(gx - 1, gy - 1, 66, 4);
    const frac = Math.min(1, spd / (p.spec.maxSpeed * 1.4));
    const fast = p.body.nitroTime > 0 ? UI.cyan : p.body.boost > 0 ? UI.orange : UI.lime;
    h.gauge.fillStyle(fast, 1).fillRect(gx, gy, Math.round(64 * frac), 2);

    this.updateNitro();
    this.updateDrift();

    // minimap dots, player drawn last
    h.dots.clear();
    const m = this.map;
    const order = [...race.racers].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer));
    for (const r of order) {
      const mx = Math.round(h.mapX + (r.body.x - m.ox) * m.scale + m.pad);
      const my = Math.round(h.mapY + (r.body.y - m.oy) * m.scale + m.pad);
      if (r.isPlayer) {
        h.dots.fillStyle(UI.ink, 1).fillRect(mx - 2, my - 2, 5, 5);
        h.dots.fillStyle(UI.yellow, 1).fillRect(mx - 1, my - 1, 3, 3);
      } else {
        h.dots.fillStyle(UI.ink, 1).fillRect(mx - 1, my - 1, 4, 4);
        h.dots.fillStyle(this.views[r.index].color, 1).fillRect(mx, my, 2, 2);
      }
    }
    for (const mi of race.items.missiles) {
      const mx = Math.round(h.mapX + (mi.x - m.ox) * m.scale + m.pad);
      const my = Math.round(h.mapY + (mi.y - m.oy) * m.scale + m.pad);
      h.dots.fillStyle(Math.floor(this.clock * 8) % 2 ? UI.red : UI.white, 1).fillRect(mx - 1, my - 1, 2, 2);
    }
    h.wrong.setVisible(p.wrongWay > 1 && !p.finished && Math.floor(this.clock * 3) % 2 === 0);
    // going the wrong way, or stuck off the road: point out the reset
    const lost = this.phase === 'racing' && (p.wrongWay > 1 || this.stuck > 1.5);
    h.resetHint.setVisible(lost);
    if (lost) h.resetHint.setText(this.controls.hasTouch ? 'TAP R TO RESET' : firstPad(this) ? 'PRESS BACK TO RESET' : 'PRESS R TO RESET');

    // item boxes: a faint outline when empty; dimmed when the item can't be used yet
    // (a missile with nothing ahead to aim at, a shield while one is already up)
    for (const kind of ITEM_KINDS) {
      const s = h.slots[kind];
      const held = p.held[kind];
      const ready = kind === 'shield' ? p.shield <= 0 : held && race.items.targets(p).length > 0;
      s.icon.setAlpha(!held ? 0.15 : ready ? 1 : 0.4);
      s.key.setVisible(held);
    }
    h.coins.setText(String(p.coins)).setTint(p.coins >= MAX_COINS ? UI.yellow : UI.white);
    const incoming = race.items.incoming(p) < Infinity && !p.finished;
    h.missileWarn.setVisible(incoming && Math.floor(this.clock * 6) % 2 === 0);
    const shieldKey = this.controls.hasTouch ? 'TAP SHIELD' : firstPad(this) ? 'UP: SHIELD' : 'G: SHIELD';
    if (incoming) h.missileWarn.setText(p.held.shield && p.shield <= 0 ? `MISSILE! ${shieldKey}` : 'MISSILE!');
  }

  private showNoTarget(): void {
    const t = this.hud.noTarget;
    this.tweens.killTweensOf(t);
    t.setAlpha(1);
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300 });
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    if (this.controls.pausePressed() && this.phase !== 'done') this.togglePause();
    if (Phaser.Input.Keyboard.JustDown(this.menuKeys.M)) toggleMute();
    if (this.controls.viewPressed()) this.toggleView();
    // read every frame, so a press made during the pause doesn't go off afterwards
    const reset = this.controls.resetPressed();
    if (this.paused) {
      this.updatePause();
      return;
    }
    this.clock += dt;
    if (this.phase === 'countdown') this.countdown();
    if (reset) this.resetCar();

    const ctl = this.controls.read();
    for (const kind of ITEM_KINDS) {
      if (this.taps[kind]) ctl[kind] = true;
      this.taps[kind] = false;
    }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYSICS_DT && steps < 14) {
      this.race.step(PHYSICS_DT, ctl);
      this.acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 14) this.acc = 0;
    this.handleEvents();
    this.updateCamera(dt);
    this.drawCars(dt);
    this.itemSprites.update(this.clock);
    for (const m of this.race.items.missiles) {
      const tx = m.x - Math.cos(m.angle) * 6;
      const ty = m.y - Math.sin(m.angle) * 6;
      this.emit('flame', tx, ty, 1);
      if (Math.random() < 0.4) this.emit('smoke', tx, ty, 1);
    }
    // beeps while a missile is coming for you, quicker as it closes in
    const coming = this.race.items.incoming(this.race.player);
    this.warnIn -= dt;
    if (coming < 900 && this.warnIn <= 0 && this.phase === 'racing') {
      sfx.warn();
      this.warnIn = Math.max(0.12, (coming / 900) * 0.45);
    }
    if (this.view === 'chase') this.chase?.update(dt, this.views);
    const p = this.race.player;
    this.stuck = this.phase === 'racing' && p.surface === 'offroad' && speedOf(p.body) < 15 ? this.stuck + dt : 0;
    this.updateHud();

    const spd = speedOf(p.body) / p.spec.maxSpeed;
    const skid = p.surface === 'offroad' ? 0 : Math.min(1, slipSpeed(p.body) / 120 + (p.body.drift ? 0.6 : 0));
    sfx.updateEngine(spd, this.race.started ? p.controls.throttle : ctl.throttle, skid, p.surface === 'offroad');

    if (this.phase === 'done') {
      this.finishTimer += dt;
      // the results come up on their own; Enter, Space or gamepad A skips the wait
      const ready = this.finishTimer > 0.8;
      const padA = firstPad(this)?.A ?? false;
      const press = Phaser.Input.Keyboard.JustDown(this.menuKeys.ENTER) || Phaser.Input.Keyboard.JustDown(this.menuKeys.SPACE) || (padA && !this.padConfirmHeld);
      this.padConfirmHeld = padA;
      this.hud.continueHint.setVisible(ready && this.finishTimer > 0 && Math.floor(this.finishTimer * 2) % 2 === 0);
      if ((ready && press) || this.finishTimer > 6 || (this.race.allFinished() && this.finishTimer > 2.5)) this.showResults();
    }
  }

  private countdown(): void {
    const t = this.clock;
    const n = t < 0.6 ? -1 : t < 1.4 ? 0 : t < 2.2 ? 1 : t < 3.0 ? 2 : 3;
    if (n === this.lastCount) return;
    this.lastCount = n;
    const { lights } = this.hud;
    if (n >= 0 && n < 3) {
      lights[n].setTexture('icon-lightRed');
      sfx.countdown(false);
      this.flash(String(3 - n), '', UI.white, 4, 500);
    } else if (n === 3) {
      lights.forEach((l) => l.setTexture('icon-lightGreen'));
      sfx.countdown(true);
      this.flash('GO!', '', UI.lime, 5, 600);
      this.race.started = true;
      this.phase = 'racing';
      this.resetBtn.setEnabled(true);
      // each track has its own song
      sfx.music(this.race.geom.def.theme);
      this.time.delayedCall(1200, () => {
        this.tweens.add({ targets: [...lights, this.hud.lightPanel], alpha: 0, duration: 300 });
      });
    }
  }

  /** Eight segments that fill as you drift and drain while the nitro burns; a full gauge says which key fires it. */
  private updateNitro(): void {
    const h = this.hud;
    const b = this.race.player.body;
    const burning = b.nitroTime > 0;
    const full = b.nitro >= 1 && !burning;
    const blink = Math.floor(this.clock * 6) % 2 === 0;
    h.nitroReady.setVisible(full).setTint(blink ? UI.yellow : UI.white);
    h.nitroLabel.setVisible(!full).setText(burning ? 'BOOST' : 'NITRO').setTint(burning ? UI.cyan : UI.grey);
    const g = h.nitroBar.clear();
    if (full) return;
    const y = GAME_H - 42;
    for (let i = 0; i < 8; i++) {
      const x = h.nitroX + i * 5;
      g.fillStyle(UI.ink, 1).fillRect(x, y, 4, 5);
      const f = Math.max(0, Math.min(1, b.nitro * 8 - i));
      if (f <= 0) continue;
      g.fillStyle(burning && i % 2 ? UI.white : UI.cyan, 1).fillRect(x, y, Math.max(1, Math.round(4 * f)), 5);
    }
  }

  /** Live drift combo: points, multiplier, and how long you have to chain the next drift. */
  private updateDrift(): void {
    const h = this.hud;
    const p = this.race.player;
    h.driftBar.clear();
    if (p.driftPoints <= 0) {
      if (!this.driftResult) {
        h.driftTitle.setText('');
        h.driftPoints.setText('');
        h.driftCombo.setText('');
      }
      return;
    }
    this.driftResult = false;
    this.tweens.killTweensOf([h.driftTitle, h.driftPoints, h.driftCombo]);
    h.driftTitle.setText('DRIFT').setTint(UI.cyan).setAlpha(1);
    h.driftPoints.setText(points(p.driftPoints)).setTint(UI.white).setAlpha(1).setScale(1);
    h.driftCombo.setText(p.driftCombo > 1 ? `X${p.driftCombo}` : '').setAlpha(1);
    h.driftCombo.setX(Math.round(GAME_W / 2 + h.driftPoints.width / 2 + 4));
    // time left to chain the next drift
    const left = p.body.drift ? 1 : Math.max(0, 1 - p.driftGap / DRIFT_CHAIN);
    h.driftBar.fillStyle(UI.ink, 1).fillRect(GAME_W / 2 - 21, 81, 42, 3);
    h.driftBar.fillStyle(p.driftCombo > 1 ? UI.yellow : UI.cyan, 1).fillRect(GAME_W / 2 - 20, 82, Math.round(40 * left), 1);
  }

  /** Shows a finished combo's result for a moment. */
  private driftPopup(title: string, value: string, color: number): void {
    const h = this.hud;
    this.driftResult = true;
    this.tweens.killTweensOf([h.driftTitle, h.driftPoints, h.driftCombo]);
    h.driftTitle.setText(title).setTint(color).setAlpha(1);
    h.driftPoints.setText(value).setTint(color).setAlpha(1).setScale(1.4);
    h.driftCombo.setText('');
    this.tweens.add({ targets: h.driftPoints, scale: 1, duration: 220, ease: 'Back.Out' });
    this.tweens.add({
      targets: [h.driftTitle, h.driftPoints],
      alpha: 0,
      delay: 900,
      duration: 300,
      onComplete: () => (this.driftResult = false),
    });
  }

  private handleEvents(): void {
    const race = this.race;
    const cam = this.cameras.main;
    for (const e of race.events) {
      switch (e.type) {
        case 'wall':
          this.emit('sparks', e.x, e.y, Math.min(10, 3 + Math.round(e.impact / 30)), e.racer.body.z);
          if (e.racer.isPlayer) {
            sfx.wall(e.impact);
            // only the overhead view shakes: the chase view keeps the horizon still
            if (this.view === 'top') cam.shake(120, Math.min(0.01, e.impact / 25000));
          }
          break;
        case 'bump':
          this.emit('sparks', e.x, e.y, 5, e.a.body.z);
          if (e.a.isPlayer || e.b.isPlayer) {
            sfx.bump(e.impact);
            if (this.view === 'top') cam.shake(90, Math.min(0.008, e.impact / 30000));
          }
          break;
        case 'lap':
          if (e.racer.isPlayer) {
            const final = e.lap === race.laps;
            sfx.lap(final);
            this.flash(final ? 'FINAL LAP!' : `LAP ${e.lap}`, `LAST LAP ${formatTime(e.time)}`, final ? UI.orange : UI.yellow, 3, 1300);
          }
          break;
        case 'finish':
          if (e.racer.isPlayer) this.onPlayerFinish(e.place);
          break;
        case 'boostPad':
          if (e.racer.isPlayer) sfx.boost();
          this.burst(e.racer, 8);
          break;
        case 'driftStart':
          this.views[e.racer.index].hop = 0.14;
          if (e.racer.isPlayer) sfx.driftStart(e.combo);
          break;
        case 'driftBank':
          if (e.racer.isPlayer) {
            sfx.driftBank(e.points);
            const title = e.points >= 20000 ? 'INSANE DRIFT!' : e.points >= 8000 ? 'GREAT DRIFT!' : 'NICE DRIFT!';
            this.driftPopup(title, `+${points(e.points)}`, UI.yellow);
          }
          break;
        case 'driftCrash':
          if (e.racer.isPlayer) {
            sfx.driftCrash();
            this.driftPopup('CRASH!', points(e.points), UI.red);
          }
          break;
        case 'nitroReady':
          if (e.racer.isPlayer) sfx.nitroReady();
          break;
        case 'nitro':
          if (e.racer.isPlayer) sfx.nitro();
          this.burst(e.racer, 10, 'nitro');
          break;
        case 'coin':
          this.emit('gold', e.x, e.y - 2, e.racer.isPlayer ? 6 : 3, e.racer.ground);
          if (e.racer.isPlayer) sfx.coin(e.racer.coins);
          break;
        case 'pickup':
          this.emit('sparks', e.x, e.y, 5, e.racer.ground);
          if (e.racer.isPlayer) sfx.pickup(e.item === 'missile');
          break;
        case 'shieldUp':
          if (e.racer.isPlayer) sfx.shieldUp();
          break;
        case 'missile':
          this.burst(e.racer, 6);
          if (e.racer.isPlayer || e.target.isPlayer) sfx.launch();
          break;
        case 'noTarget':
          if (e.racer.isPlayer) {
            sfx.noTarget();
            this.showNoTarget();
          }
          break;
        case 'boom': {
          this.emit(e.blocked ? 'sparks' : 'flame', e.x, e.y, e.blocked ? 10 : 14, e.racer.body.z);
          if (!e.blocked) {
            this.emit('smoke', e.x, e.y, 10, e.racer.body.z);
            this.views[e.racer.index].hop = 0.25;
          }
          // spilled coins
          if (e.lost) this.emit('gold', e.racer.body.x, e.racer.body.y, e.lost * 4, e.racer.ground);
          const mine = e.racer.isPlayer;
          if (mine || e.by.isPlayer) {
            if (e.blocked) sfx.shieldBlock();
            else sfx.boom();
          }
          if (mine) {
            this.flash(e.blocked ? 'BLOCKED!' : 'BOOM!', e.blocked ? 'YOUR SHIELD TOOK IT' : '', e.blocked ? UI.cyan : UI.red, 3, 700);
            if (!e.blocked && this.view === 'top') cam.shake(200, 0.008);
          } else if (e.by.isPlayer) {
            this.flash(e.blocked ? 'BLOCKED' : 'HIT!', e.blocked ? `${e.racer.name} HAD A SHIELD` : `${e.racer.name} IS STOPPED`, e.blocked ? UI.cyan : UI.yellow, 2, 700);
          }
          break;
        }
        case 'fizzle':
          this.emit('smoke', e.x, e.y, 4);
          break;
        case 'knock':
          this.emit('debris', e.x, e.y - 3, 10, e.racer.ground);
          if (e.lost) this.emit('gold', e.racer.body.x, e.racer.body.y, e.lost * 4, e.racer.ground);
          if (e.racer.isPlayer) sfx.knock();
          break;
        case 'splash':
          this.emit('splash', e.x, e.y, 8, e.racer.ground);
          if (e.racer.isPlayer) sfx.splash();
          break;
        case 'land':
          // a puff of dust (or sand) from a proper jump, and a thump
          if (e.air > 0.2) {
            this.emit('dust', e.racer.body.x, e.racer.body.y, Math.min(14, 4 + Math.round(e.impact / 20)), e.racer.ground);
            this.views[e.racer.index].hop = 0.1;
            if (e.racer.isPlayer) sfx.land(e.impact);
          }
          break;
        case 'air':
          if (e.racer.isPlayer) {
            sfx.driftBank(e.points);
            this.driftPopup(e.time >= 0.6 ? 'BIG AIR!' : 'AIR!', `+${points(e.points)}`, UI.cyan);
          }
          break;
      }
    }
    race.events.length = 0;
  }

  /** R: your car vanishes in a puff and pops back onto the road, facing the right way. */
  private resetCar(): void {
    if (this.paused || this.phase !== 'racing') return;
    const p = this.race.player;
    const { x, y } = p.body;
    const z = p.body.z;
    if (!this.race.resetToTrack(p)) return;
    sfx.reset();
    this.emit('smoke', x, y, 8, z);
    this.emit('smoke', p.body.x, p.body.y, 8, p.body.z);
    this.views[p.index].hop = 0.14;
    this.stuck = 0;
    // the chase camera cuts straight behind the car rather than swinging round to it
    this.chase?.snap();
  }

  private burst(r: Racer, count: number, kind: 'flame' | 'nitro' = 'flame'): void {
    const b = r.body;
    this.emit(kind, b.x - Math.cos(b.angle) * r.spec.halfLength, b.y - Math.sin(b.angle) * r.spec.halfLength, count, b.z);
  }

  private onPlayerFinish(place: number): void {
    this.phase = 'done';
    this.finishTimer = 0;
    this.resetBtn.setEnabled(false);
    // forget presses from during the race, so only a fresh one skips to the results
    Phaser.Input.Keyboard.JustDown(this.menuKeys.ENTER);
    Phaser.Input.Keyboard.JustDown(this.menuKeys.SPACE);
    this.padConfirmHeld = true;
    sfx.finish(place);
    sfx.music(null);
    const color = place === 1 ? UI.yellow : place === 2 ? UI.white : place === 3 ? UI.orange : UI.grey;
    this.flash('FINISH!', `YOU PLACED ${ordinal(place)}`, color, 4, 0);
    if (place <= 3) {
      for (let i = 0; i < 6; i++) {
        this.time.delayedCall(i * 160, () => this.confetti.emitParticleAt(40 + Math.random() * (GAME_W - 80), -4, 18));
      }
    }
  }

  private drawCars(dt: number): void {
    const now = this.clock;
    for (const r of this.race.racers) {
      const v = this.views[r.index];
      const b = r.body;
      v.look = b.steer < -0.3 ? LOOK_LEFT : b.steer > 0.3 ? LOOK_RIGHT : LOOK_AHEAD;
      const frame = carFrame(directionFrame(b.angle), v.look);
      const spd = speedOf(b);
      v.hop = Math.max(0, v.hop - dt);
      const flying = b.air > 0;
      v.bob = (spd > 15 && !flying && Math.floor(now * 11 + r.index * 3) % 2 === 0 ? -1 : 0) - (v.hop > 0 ? 2 : 0);
      // just back from a missile hit: blinks while it can't be knocked out again
      const blink = r.immune > 0 && b.stun <= 0 && Math.floor(now * 10) % 2 === 0;
      // in the air the car rises towards you, and its shadow stays on the road, further off the higher it is
      const air = Math.max(0, b.z - r.ground);
      const depth = r.onDeck ? DEPTH.deckCar : DEPTH.car;
      v.car.setFrame(frame).setPosition(b.x, b.y + v.bob - air * 0.35).setScale(1 + air * 0.015).setDepth(depth + b.y / 100000).setAlpha(blink ? 0.35 : 1);
      v.shadow.setFrame(frame).setPosition(b.x + 2 + air * 0.55, b.y + 3 + air * 0.35).setDepth(r.onDeck ? DEPTH.deckShadow : DEPTH.shadow).setAlpha(0.32 / (1 + air * 0.04));
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      if (v.cone) v.cone.setPosition(b.x + cos * 9, b.y + sin * 9 + v.bob).setRotation(b.angle);

      // rear wheel positions
      const rx = b.x - cos * r.spec.halfLength * 0.6;
      const ry = b.y - sin * r.spec.halfLength * 0.6;
      const wx = -sin * r.spec.radius * 0.75;
      const wy = cos * r.spec.radius * 0.75;
      const slip = slipSpeed(b);
      const braking = r.controls.throttle < 0 && spd > 110;
      // tyre marks are painted into the ground, so none in the air or on a bridge (they'd land on the road below)
      if (r.surface !== 'offroad' && !flying && !r.onDeck && (slip > 45 || b.drift || braking)) {
        const cfg = { alpha: 0.4, tint: this.theme.skid };
        for (const side of [1, -1]) {
          this.skids.stamp('dot', undefined, rx + wx * side, ry + wy * side, cfg);
          this.chase?.skid(rx + wx * side, ry + wy * side);
        }
        this.skidDirty = true;
      }
      if (r.surface === 'offroad' && !flying && spd > 40 && Math.random() < 0.5) {
        this.emit('dust', rx + (Math.random() - 0.5) * 8, ry + (Math.random() - 0.5) * 8, 1, r.ground);
      }
      if (r.inPuddle && spd > 40 && Math.random() < 0.6) this.emit('splash', rx + (Math.random() - 0.5) * 8, ry + (Math.random() - 0.5) * 8, 1, r.ground);
      // tyre smoke pours off the rear wheels while drifting
      if (b.drift && !flying && r.surface !== 'offroad') {
        for (const side of [1, -1]) if (Math.random() < 0.7) this.emit('smoke', rx + wx * side, ry + wy * side, 1, r.ground);
      }
      if (b.boost > 0 && Math.random() < 0.8) this.burst(r, 1);
      if (b.nitroTime > 0) this.burst(r, 2, 'nitro');
    }
    if (this.skidDirty) {
      this.skids.render();
      this.skidDirty = false;
    }
    this.fadeDecks(dt);
  }

  /** A bridge deck turns see-through while your car is underneath it, so you can see where you're going. */
  private fadeDecks(dt: number): void {
    const p = this.race.player;
    const g = this.race.geom;
    const edge = g.wallDist + WALL_THICKNESS;
    const under = g.decks.some((d) => {
      const x = Math.floor(p.body.x) - d.x0;
      const y = Math.floor(p.body.y) - d.y0;
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
      const k = d.seg[y * d.w + x];
      return k >= 0 && d.dist2[y * d.w + x] < edge * edge && heightAt(g, k * g.ds) - p.body.z > 12;
    });
    this.deckFade += Math.sign((under ? 1 : 0) - this.deckFade) * Math.min(Math.abs((under ? 1 : 0) - this.deckFade), dt * 5);
    for (const img of this.decks) img.setAlpha(1 - 0.55 * this.deckFade);
  }

  /** Overhead camera: follows the car, leading it a little in the direction it is moving. */
  private updateCamera(dt: number, snap = false): void {
    const b = this.race.player.body;
    const k = 1 - Math.exp(-dt * 3);
    this.lookX += (b.vx * 0.3 - this.lookX) * k;
    this.lookY += (b.vy * 0.3 - this.lookY) * k;
    const f = snap ? 1 : 1 - Math.exp(-dt * 10);
    this.camX += (b.x + this.lookX - this.camX) * f;
    this.camY += (b.y + this.lookY - this.camY) * f;
    this.cameras.main.centerOn(this.camX, this.camY);
  }

  // ---------------------------------------------------------------------------
  // Pause & finish
  // ---------------------------------------------------------------------------

  private togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) {
      sfx.updateEngine(0, 0, 0, false);
      this.tweens.pauseAll();
      this.time.paused = true;
      const root = this.add.container(0, 0).setScrollFactor(0).setDepth(100);
      const shade = this.add.rectangle(0, 0, GAME_W, GAME_H, UI.ink, 0.6).setOrigin(0, 0);
      const box = panel(this, GAME_W / 2 - 74, 60, 148, 140);
      const title = label(this, GAME_W / 2, 72, 'PAUSED', { scale: 2, color: UI.yellow, originX: 0.5 });
      const items = [0, 1, 2, 3].map((i) => label(this, GAME_W / 2, 100 + i * 18, '', { originX: 0.5 }));
      items.forEach((t, i) => {
        t.setInteractive({ useHandCursor: true });
        t.on('pointerover', () => this.selectPause(i));
        t.on('pointerdown', () => this.choosePause(i));
      });
      const hint = label(this, GAME_W / 2, 180, 'M SOUND    V VIEW', { color: UI.grey, originX: 0.5 });
      root.add([shade, box, title, ...items, hint]);
      // the pause screen is HUD: only the HUD camera draws it
      this.cameras.main.ignore(root);
      this.pauseUi = { root, items, index: 0 };
      this.selectPause(0, true);
    } else {
      this.tweens.resumeAll();
      this.time.paused = false;
      this.pauseUi?.root.destroy();
      this.pauseUi = null;
    }
  }

  private pauseLabels(): string[] {
    return ['RESUME', this.view === 'chase' ? 'VIEW: CHASE' : 'VIEW: TOP', 'RESTART', 'QUIT TO MENU'];
  }

  private selectPause(i: number, silent = false): void {
    if (!this.pauseUi) return;
    if (i !== this.pauseUi.index && !silent) sfx.blip();
    this.pauseUi.index = i;
    const names = this.pauseLabels();
    this.pauseUi.items.forEach((t, k) => {
      t.setTint(k === i ? UI.yellow : UI.white);
      t.setText((k === i ? '> ' : '') + names[k] + (k === i ? ' <' : ''));
    });
  }

  private choosePause(i: number): void {
    if (i === 1) {
      this.toggleView();
      return;
    }
    sfx.confirm();
    if (i === 0) this.togglePause();
    else {
      this.tweens.resumeAll();
      this.time.paused = false;
      sfx.music(null);
      if (i === 2) this.scene.restart({ car: this.carId, track: this.trackId });
      else goTo(this, 'title');
    }
  }

  private updatePause(): void {
    const ui = this.pauseUi;
    if (!ui) return;
    const k = this.menuKeys;
    const J = Phaser.Input.Keyboard.JustDown;
    if (J(k.UP) || J(k.W)) this.selectPause((ui.index + PAUSE_ITEMS - 1) % PAUSE_ITEMS);
    if (J(k.DOWN) || J(k.S)) this.selectPause((ui.index + 1) % PAUSE_ITEMS);
    if (J(k.ENTER) || J(k.SPACE)) this.choosePause(ui.index);
  }

  private showResults(): void {
    if (this.phase !== 'done' || this.finishTimer < 0) return;
    this.finishTimer = -Infinity;
    const race = this.race;
    const p = race.player;
    const standings: Standing[] = race
      .standings()
      .map((r) => ({
        name: r.name,
        design: r.design.id,
        alt: r.alt,
        isPlayer: r.isPlayer,
        time: race.projectedTime(r),
        bestLap: r.bestLap,
        finished: r.finished,
      }));
    const records = submitResult(this.trackId, race.difficulty, this.carId, p.finishTime, p.bestLap);
    const data: RaceResultData = {
      car: this.carId,
      track: this.trackId,
      difficulty: race.difficulty,
      standings,
      playerPlace: p.place,
      playerTime: p.finishTime,
      bestLap: p.bestLap,
      records,
    };
    goTo(this, 'results', data);
  }
}
