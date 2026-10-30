import Phaser from 'phaser';
import { UI } from '../config.ts';
import { CAR_DESIGNS, type CarDesign, type CarStats } from '../art/cars.ts';
import { CAR_DIRECTIONS, buildCarSheet, buildPortrait, carPalette } from '../art/sprites.ts';
import { hex, shade, toRGBInt, type Palette } from '../art/raster.ts';
import { PixelDoc } from '../game/pixelDoc.ts';
import {
  MAX_CUSTOM_CARS,
  MAX_NAME,
  STAT_BUDGET,
  customCars,
  deleteCustomCar,
  designToCode,
  findCar,
  isCustom,
  newCarId,
  saveCustomCar,
} from '../game/customCars.ts';
import { sfx } from '../game/audio.ts';
import { addRaster, carFrame, registerCar, unregisterCar } from '../ui/textures.ts';
import { button, dialog, firstPad, goTo, label, panel, stripes, toast, toggleMute, type Button } from '../ui/ui.ts';

type View = 'top' | 'front';
type Tool = 'pen' | 'erase' | 'fill' | 'pick';
type StatKey = keyof CarStats;

/** Paint pots: the letters of the car format, in the order shown in the palette. */
const POTS: [string, string][] = [
  ['B', 'BODY'],
  ['h', 'BODY LIGHT'],
  ['b', 'BODY SHADOW'],
  ['a', 'STRIPE'],
  ['A', 'STRIPE SHADOW'],
  ['n', 'DECAL'],
  ['i', 'IRIS'],
  ['.', 'ERASER'],
  ['k', 'OUTLINE'],
  ['W', 'EYE WHITE'],
  ['w', 'EYE SHADOW'],
  ['p', 'PUPIL'],
  ['y', 'HEADLIGHT'],
  ['Y', 'LIGHT SHINE'],
  ['R', 'TAIL LIGHT'],
  ['t', 'TYRE'],
  ['T', 'TYRE TREAD'],
  ['g', 'GLASS'],
  ['G', 'GLASS SHINE'],
  ['q', 'TEETH'],
  ['m', 'MOUTH'],
  ['u', 'TONGUE / BLUSH'],
  ['z', 'CHROME'],
  ['Z', 'CHROME SHINE'],
  ['s', 'DARK TRIM'],
];

const COLORS = [
  '#1a1c2c', '#5d275d', '#b13e53', '#e43b44', '#ef7d57', '#f77622', '#ffcd75', '#fff3a0',
  '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#c4f4ff',
  '#ff9ec8', '#e06aa0', '#c3a6ff', '#8f6fd9', '#ffd6ea', '#e2ffc4', '#9a5a32', '#e8a46b',
  '#f4f4f4', '#c2c8d6', '#94b0c2', '#566c86', '#333c57', '#3a2a3e', '#6b412a', '#000000',
];

const STATS: [StatKey, string][] = [
  ['speed', 'SPEED'],
  ['accel', 'ACCEL'],
  ['handling', 'HANDLING'],
  ['weight', 'WEIGHT'],
];

const NAME_START = ['ZO', 'PI', 'MO', 'KU', 'RI', 'TA', 'BO', 'LU', 'NE', 'FI', 'DO', 'KA', 'MI', 'SU', 'RO', 'BI', 'ZE', 'PO'];
const NAME_END = ['KO', 'BY', 'ZY', 'MO', 'RO', 'KI', 'PO', 'LU', 'TO', 'NI', 'PIP', 'BO', 'MI', 'RU'];

// layout: drawing canvas | tools and paint | preview, name, stats and tips
const CANVAS = { x: 6, y: 22, w: 200, h: 222 };
const TOOLS_X = 212;
const POTS_Y = 95;
const COLORS_Y = 163;
const SIDE_X = 330;
const PITCH = 14;

function shadeHex(color: string, f: number): string {
  return '#' + toRGBInt(shade(hex(color), f)).toString(16).padStart(6, '0');
}

/** Index in an 8-wide swatch grid at (TOOLS_X, top), or -1 outside it (hit areas include their far edges). */
function swatchIndex(p: Phaser.Input.Pointer, top: number): number {
  const col = Math.floor((p.x - TOOLS_X) / PITCH);
  const row = Math.floor((p.y - top) / PITCH);
  return col >= 0 && col < 8 && row >= 0 && row < 4 ? row * 8 + col : -1;
}

function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return pick(NAME_START) + pick(NAME_END);
}

/** Lowers the stats until they fit the points budget (weight first, then speed). */
function fitBudget(s: CarStats): CarStats {
  const out = { ...s };
  const order: StatKey[] = ['weight', 'speed', 'accel', 'handling'];
  let k = 0;
  while (out.speed + out.accel + out.handling + out.weight > STAT_BUDGET && k < 40) {
    const key = order[k % order.length];
    if (out[key] > 1) out[key]--;
    k++;
  }
  return out;
}

export class PaintShopScene extends Phaser.Scene {
  private carId = '';
  private isNew = true;
  private carName = '';
  private stats: CarStats = { speed: 3, accel: 3, handling: 3, weight: 3 };
  private palette: Palette = {};
  private docs!: Record<View, PixelDoc>;
  private view: View = 'top';
  private tool: Tool = 'pen';
  private mirror = true;
  private pot = 'B';
  private saved = '';
  private zoom = 8;
  private gx = 0;
  private gy = 0;
  private stroke: { x: number; y: number; ch: string } | null = null;
  private hover: { x: number; y: number } | null = null;
  private editingName = false;
  private nameSelected = false;
  private closeModal: (() => void) | null = null;
  private hoverHint = '';
  private dir = 0;
  private spinClock = 0;
  private blink = 0;
  private cursorClock = 0;
  private previewDirty = true;
  private sinceBuild = 1;
  private padBackHeld = true;

  private gridGfx!: Phaser.GameObjects.Graphics;
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private potGfx!: Phaser.GameObjects.Graphics;
  private colorGfx!: Phaser.GameObjects.Graphics;
  private tabs!: Record<View, Button>;
  private tools!: Record<Tool, Button>;
  private mirrorBtn!: Button;
  private undoBtn!: Button;
  private redoBtn!: Button;
  private deleteBtn!: Button;
  private potLabel!: Phaser.GameObjects.BitmapText;
  private nameText!: Phaser.GameObjects.BitmapText;
  private hint!: Phaser.GameObjects.BitmapText;
  private pointsText!: Phaser.GameObjects.BitmapText;
  private modeText!: Phaser.GameObjects.BitmapText;
  private statRows: { minus: Button; plus: Button; pips: Phaser.GameObjects.Image[] }[] = [];
  private spinner!: Phaser.GameObjects.Sprite;
  private face!: Phaser.GameObjects.Image;

  constructor() {
    super('paint');
  }

  init(data: { edit?: string; base?: string }): void {
    const existing = data.edit ? findCar(data.edit) : undefined;
    const own = existing && isCustom(existing.id) ? existing : undefined;
    const base = own ?? CAR_DESIGNS.find((d) => d.id === data.base) ?? CAR_DESIGNS[0];
    this.isNew = !own;
    this.carId = own ? own.id : newCarId();
    this.carName = own ? own.name.toUpperCase() : randomName();
    this.stats = fitBudget(base.stats);
    this.palette = { ...carPalette(base) };
    this.docs = { top: new PixelDoc(base.top), front: new PixelDoc(base.front) };
    this.view = 'top';
    this.tool = 'pen';
    this.mirror = true;
    this.pot = 'B';
    this.stroke = null;
    this.hover = null;
    this.editingName = false;
    this.nameSelected = false;
    this.padBackHeld = true;
    this.closeModal = null;
    this.hoverHint = '';
    this.previewDirty = true;
    this.statRows = [];
    this.saved = this.snapshot();
  }

  private get doc(): PixelDoc {
    return this.docs[this.view];
  }

  private snapshot(): string {
    return JSON.stringify([this.carName, this.stats, this.palette, this.docs.top.rows(), this.docs.front.rows()]);
  }

  private get dirty(): boolean {
    return this.snapshot() !== this.saved;
  }

  private design(): CarDesign {
    const name = this.carName.trim() || 'MY CAR';
    return {
      id: this.carId,
      name,
      tagline: 'Painted in your paint shop',
      stats: { ...this.stats },
      palette: { ...this.palette },
      alt: { name, palette: {} },
      top: this.docs.top.rows(),
      front: this.docs.front.rows(),
    };
  }

  private rgb(ch: string): number {
    return parseInt((this.palette[ch] ?? '#ff00ff').slice(1), 16);
  }

  // ---------------------------------------------------------------------------
  // Build the screen
  // ---------------------------------------------------------------------------

  create(): void {
    sfx.music('menu');
    stripes(this, 0x1f2236, 0x232842);
    this.input.mouse?.disableContextMenu();
    // keep Tab / Backspace / Space inside the game while editing
    this.input.keyboard?.addCapture('TAB,SPACE,BACKSPACE');
    this.events.once('shutdown', () => this.input.keyboard?.removeCapture('TAB,SPACE,BACKSPACE'));

    label(this, 8, 5, 'PAINT SHOP', { scale: 2, color: UI.yellow });
    this.tabs = {
      top: button(this, 138, 4, 56, 15, 'TOP VIEW', () => this.setView('top')),
      front: button(this, 196, 4, 40, 15, 'FACE', () => this.setView('front')),
    };
    this.modeText = label(this, 474, 8, this.isNew ? 'NEW CAR' : 'EDITING', { color: UI.grey, originX: 1 });

    // canvas
    panel(this, CANVAS.x, CANVAS.y, CANVAS.w, CANVAS.h, 0x1b1e33);
    this.gridGfx = this.add.graphics();
    this.cursorGfx = this.add.graphics();
    const zone = this.add.zone(CANVAS.x, CANVAS.y, CANVAS.w, CANVAS.h).setOrigin(0, 0).setInteractive({ cursor: 'crosshair' });
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => this.strokeStart(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', () => this.strokeEnd());
    this.input.on('pointerupoutside', () => this.strokeEnd());

    // tools
    panel(this, 210, 22, 116, 222, 0x262b44);
    label(this, 214, 26, 'TOOLS', { color: UI.grey });
    const toolBtn = (t: Tool, text: string, x: number, y: number) => button(this, x, y, 36, 14, text, () => this.setTool(t));
    this.tools = {
      pen: toolBtn('pen', 'PEN', TOOLS_X, 35),
      erase: toolBtn('erase', 'ERASE', TOOLS_X + 38, 35),
      fill: toolBtn('fill', 'FILL', TOOLS_X + 76, 35),
      pick: toolBtn('pick', 'PICK', TOOLS_X, 51),
    };
    this.undoBtn = button(this, TOOLS_X + 38, 51, 36, 14, 'UNDO', () => this.undo());
    this.redoBtn = button(this, TOOLS_X + 76, 51, 36, 14, 'REDO', () => this.redo());
    this.mirrorBtn = button(this, TOOLS_X, 67, 112, 14, 'MIRROR: ON', () => this.toggleMirror());

    label(this, 214, 86, 'PAINT POTS', { color: UI.grey });
    this.potGfx = this.add.graphics();
    const potZone = this.add.zone(TOOLS_X, POTS_Y, 8 * PITCH, 4 * PITCH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const potAt = (p: Phaser.Input.Pointer) => {
      const i = swatchIndex(p, POTS_Y);
      return i < 0 ? undefined : POTS[i];
    };
    potZone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const pot = potAt(p);
      if (pot) this.choosePot(pot[0]);
    });
    potZone.on('pointermove', (p: Phaser.Input.Pointer) => {
      const pot = potAt(p);
      this.setHoverHint(pot ? `PAINT POT: ${pot[1]}` : '');
    });
    potZone.on('pointerout', () => this.setHoverHint(''));
    this.potLabel = label(this, 214, 153, '', { color: UI.yellow });

    this.colorGfx = this.add.graphics();
    const colorZone = this.add.zone(TOOLS_X, COLORS_Y, 8 * PITCH, 4 * PITCH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    colorZone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const i = swatchIndex(p, COLORS_Y);
      if (i >= 0 && COLORS[i]) this.recolor(COLORS[i]);
    });
    colorZone.on('pointermove', () => this.setHoverHint('CLICK A COLOUR TO REFILL THE SELECTED POT. BODY AND STRIPE ALSO SET THEIR SHADES.'));
    colorZone.on('pointerout', () => this.setHoverHint(''));
    button(this, TOOLS_X, 222, 55, 14, 'LIGHTER', () => this.nudge(0.14));
    button(this, TOOLS_X + 57, 222, 55, 14, 'DARKER', () => this.nudge(-0.14));

    // preview, name, stats, tips
    panel(this, SIDE_X, 22, 144, 222, 0x262b44);
    panel(this, SIDE_X + 4, 26, 136, 80, 0x4a4f6a, UI.ink);
    this.spinner = this.add.sprite(SIDE_X + 38, 66, '__DEFAULT').setScale(2);
    this.face = this.add.image(SIDE_X + 106, 102, '__DEFAULT').setOrigin(0.5, 1).setScale(2);
    label(this, SIDE_X + 4, 114, 'NAME', { color: UI.grey });
    this.nameText = label(this, SIDE_X + 32, 114, '', { color: UI.yellow });
    const nameZone = this.add.zone(SIDE_X + 30, 110, 92, 14).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    nameZone.on('pointerdown', () => this.startNameEdit());
    nameZone.on('pointermove', () => this.setHoverHint('CLICK TO TYPE A NEW NAME.'));
    nameZone.on('pointerout', () => this.setHoverHint(''));
    button(this, SIDE_X + 124, 110, 16, 14, '?', () => {
      this.carName = randomName();
      this.endNameEdit();
      sfx.blip();
    });
    STATS.forEach(([key, text], row) => {
      const y = 131 + row * 13;
      label(this, SIDE_X + 4, y + 2, text, { color: UI.grey });
      const minus = button(this, SIDE_X + 66, y, 12, 11, '-', () => this.changeStat(key, -1));
      const pips = [0, 1, 2, 3, 4].map((i) => this.add.image(SIDE_X + 84 + i * 7, y + 5, 'icon-pip'));
      const plus = button(this, SIDE_X + 120, y, 12, 11, '+', () => this.changeStat(key, 1));
      this.statRows.push({ minus, plus, pips });
    });
    this.pointsText = label(this, SIDE_X + 4, 184, '', { color: UI.grey });
    this.hint = label(this, SIDE_X + 4, 200, '', { color: 0xc4f4ff });
    this.hint.setMaxWidth(136);

    // bottom bar
    const bw = 74;
    const actions: [string, () => void][] = [
      ['START OVER', () => this.startOver()],
      ['SAVE', () => this.save()],
      ['RACE!', () => this.race()],
      ['COPY CODE', () => this.copyCode()],
      ['DELETE', () => this.remove()],
      ['BACK', () => this.back()],
    ];
    actions.forEach(([text, fn], i) => {
      const b = button(this, 8 + i * (bw + 4), 249, bw, 16, text, fn);
      if (text === 'DELETE') this.deleteBtn = b;
    });

    const kb = this.input.keyboard!;
    const onKey = (e: KeyboardEvent) => this.key(e);
    kb.on('keydown', onKey);
    this.events.once('shutdown', () => kb.off('keydown', onKey));
    this.input.on('pointerdown', () => sfx.unlock());

    this.layoutGrid();
    this.refreshAll();
    this.rebuildPreview();
    this.cameras.main.fadeIn(200, 26, 28, 44);
  }

  update(_t: number, dms: number): void {
    // turntable preview and blinking portrait
    this.spinClock += dms;
    if (this.spinClock > 95) {
      this.spinClock = 0;
      this.dir = (this.dir + 1) % CAR_DIRECTIONS;
      if (this.textures.exists('paint-car')) this.spinner.setFrame(carFrame(this.dir, Math.floor(this.time.now / 3200) % 3));
    }
    this.blink -= dms;
    if (this.blink <= 0 && Math.random() < 0.008) this.blink = 140;
    if (this.textures.exists('paint-face')) this.face.setTexture(this.blink > 0 ? 'paint-face-blink' : 'paint-face');
    if (this.editingName) {
      this.cursorClock += dms;
      this.refreshName();
    }
    this.sinceBuild += dms / 1000;
    if (this.previewDirty && this.sinceBuild > 0.12) this.rebuildPreview();
    // drawing needs a mouse or touch, but a gamepad can always get back out with B
    const back = !!firstPad(this)?.B;
    if (back && !this.padBackHeld && !this.closeModal) this.back();
    this.padBackHeld = back;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  private layoutGrid(): void {
    const d = this.doc;
    this.zoom = Math.max(2, Math.floor(Math.min((CANVAS.w - 12) / d.w, (CANVAS.h - 12) / d.h)));
    this.gx = CANVAS.x + Math.floor((CANVAS.w - d.w * this.zoom) / 2);
    this.gy = CANVAS.y + Math.floor((CANVAS.h - d.h * this.zoom) / 2);
  }

  private cellAt(p: Phaser.Input.Pointer): { x: number; y: number } | null {
    const x = Math.floor((p.x - this.gx) / this.zoom);
    const y = Math.floor((p.y - this.gy) / this.zoom);
    return this.doc.inside(x, y) ? { x, y } : null;
  }

  private strokeStart(p: Phaser.Input.Pointer): void {
    if (this.closeModal) return;
    if (this.editingName) this.endNameEdit();
    const c = this.cellAt(p);
    if (!c) return;
    const erase = p.rightButtonDown();
    if (this.tool === 'pick' && !erase) {
      const ch = this.doc.get(c.x, c.y);
      this.choosePot(ch);
      sfx.blip();
      return;
    }
    const ch = erase || this.tool === 'erase' ? '.' : this.pot;
    this.doc.begin();
    if (this.tool === 'fill') {
      this.doc.fill(c.x, c.y, ch, this.mirror);
      this.finishEdit();
      return;
    }
    this.doc.paint(c.x, c.y, ch, this.mirror);
    this.stroke = { ...c, ch };
    this.previewDirty = true;
    this.drawGrid();
  }

  private pointerMove(p: Phaser.Input.Pointer): void {
    const c = this.cellAt(p);
    const changed = (c?.x ?? -1) !== (this.hover?.x ?? -1) || (c?.y ?? -1) !== (this.hover?.y ?? -1);
    this.hover = c;
    if (this.stroke && c && changed) {
      this.doc.line(this.stroke.x, this.stroke.y, c.x, c.y, this.stroke.ch, this.mirror);
      this.stroke.x = c.x;
      this.stroke.y = c.y;
      this.previewDirty = true;
      this.drawGrid();
    }
    if (changed) this.drawCursor();
  }

  private strokeEnd(): void {
    if (!this.stroke) return;
    this.stroke = null;
    this.finishEdit();
  }

  /** Closes an undo step and refreshes everything that shows the drawing. */
  private finishEdit(): void {
    if (this.doc.end()) this.previewDirty = true;
    this.drawGrid();
    this.refreshButtons();
  }

  private undo(): void {
    if (this.doc.undo()) {
      sfx.blip();
      this.previewDirty = true;
      this.drawGrid();
      this.refreshButtons();
    }
  }

  private redo(): void {
    if (this.doc.redo()) {
      sfx.blip();
      this.previewDirty = true;
      this.drawGrid();
      this.refreshButtons();
    }
  }

  private drawGrid(): void {
    const g = this.gridGfx;
    const d = this.doc;
    const z = this.zoom;
    g.clear();
    g.fillStyle(UI.ink, 1).fillRect(this.gx - 2, this.gy - 2, d.w * z + 4, d.h * z + 4);
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ch = d.get(x, y);
        const color = ch === '.' ? ((x + y) & 1 ? 0x30365a : 0x292e4d) : this.rgb(ch);
        g.fillStyle(color, 1).fillRect(this.gx + x * z, this.gy + y * z, z, z);
      }
    }
    if (z >= 5) {
      g.fillStyle(0x000000, 0.16);
      for (let x = 1; x < d.w; x++) g.fillRect(this.gx + x * z, this.gy, 1, d.h * z);
      for (let y = 1; y < d.h; y++) g.fillRect(this.gx, this.gy + y * z, d.w * z, 1);
    }
    if (this.mirror) {
      g.fillStyle(UI.cyan, 0.7);
      g.fillRect(Math.round(this.gx + (d.w / 2) * z), this.gy - 5, 1, 4);
      g.fillRect(Math.round(this.gx + (d.w / 2) * z), this.gy + d.h * z + 1, 1, 4);
    }
  }

  private drawCursor(): void {
    const g = this.cursorGfx;
    g.clear();
    const c = this.hover;
    if (!c || this.closeModal) return;
    const z = this.zoom;
    const frame = (cx: number, color: number) => {
      const x = this.gx + cx * z;
      const y = this.gy + c.y * z;
      g.fillStyle(color, 1);
      g.fillRect(x, y, z, 1).fillRect(x, y + z - 1, z, 1).fillRect(x, y, 1, z).fillRect(x + z - 1, y, 1, z);
    };
    frame(c.x, UI.white);
    if (this.mirror && this.doc.w - 1 - c.x !== c.x) frame(this.doc.w - 1 - c.x, UI.cyan);
  }

  // ---------------------------------------------------------------------------
  // Paint pots and colours
  // ---------------------------------------------------------------------------

  private choosePot(key: string): void {
    this.pot = key;
    if (key === '.') this.setTool('erase');
    else if (this.tool === 'erase' || this.tool === 'pick') this.setTool('pen');
    this.refreshAll();
  }

  private recolor(color: string): void {
    if (this.pot === '.') {
      toast(this, 'PICK A PAINT POT FIRST', UI.orange);
      return;
    }
    sfx.blip();
    this.palette[this.pot] = color;
    // body and stripe colours bring their own shading along
    if (this.pot === 'B') {
      this.palette.b = shadeHex(color, -0.28);
      this.palette.h = shadeHex(color, 0.5);
    } else if (this.pot === 'a') {
      this.palette.A = shadeHex(color, -0.3);
    }
    this.previewDirty = true;
    this.refreshAll();
  }

  private nudge(f: number): void {
    if (this.pot === '.') return;
    this.recolor(shadeHex(this.palette[this.pot], f));
  }

  private drawPots(): void {
    const g = this.potGfx;
    g.clear();
    POTS.forEach(([key], i) => {
      const x = TOOLS_X + (i % 8) * PITCH;
      const y = POTS_Y + Math.floor(i / 8) * PITCH;
      if (key === this.pot) g.fillStyle(UI.yellow, 1).fillRect(x - 1, y - 1, 15, 15);
      g.fillStyle(UI.ink, 1).fillRect(x, y, 13, 13);
      if (key === '.') {
        // checkerboard (transparent) with a red line: "no paint"
        g.fillStyle(0xc2c8d6, 1).fillRect(x + 1, y + 1, 11, 11);
        g.fillStyle(0x566c86, 1).fillRect(x + 7, y + 1, 5, 6).fillRect(x + 1, y + 7, 6, 5);
        g.fillStyle(UI.red, 1).fillRect(x + 2, y + 6, 9, 1);
      } else {
        g.fillStyle(this.rgb(key), 1).fillRect(x + 1, y + 1, 11, 11);
      }
    });
    const name = POTS.find(([k]) => k === this.pot)?.[1] ?? '';
    this.potLabel.setText(this.pot === '.' ? 'ERASER' : `COLOUR FOR ${name}`);
  }

  private drawColors(): void {
    const g = this.colorGfx;
    g.clear();
    const current = (this.palette[this.pot] ?? '').toLowerCase();
    COLORS.forEach((c, i) => {
      const x = TOOLS_X + (i % 8) * PITCH;
      const y = COLORS_Y + Math.floor(i / 8) * PITCH;
      if (c === current) g.fillStyle(UI.yellow, 1).fillRect(x - 1, y - 1, 15, 15);
      g.fillStyle(UI.ink, 1).fillRect(x, y, 13, 13);
      g.fillStyle(parseInt(c.slice(1), 16), 1).fillRect(x + 1, y + 1, 11, 11);
    });
  }

  // ---------------------------------------------------------------------------
  // Name and stats
  // ---------------------------------------------------------------------------

  private startNameEdit(): void {
    if (this.closeModal) return;
    this.editingName = true;
    // like a selected text field: the first key typed replaces the old name
    this.nameSelected = true;
    this.cursorClock = 0;
    this.refreshName();
    this.refreshHint();
  }

  private endNameEdit(): void {
    this.editingName = false;
    this.nameSelected = false;
    this.carName = this.carName.trim();
    this.refreshName();
    this.refreshHint();
  }

  private typeName(e: KeyboardEvent): void {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape' || e.code === 'Tab') {
      this.endNameEdit();
      return;
    }
    if (e.code === 'Backspace') this.carName = this.nameSelected ? '' : this.carName.slice(0, -1);
    else if (e.key.length === 1 && /[A-Za-z0-9 !?.'&-]/.test(e.key)) {
      if (this.nameSelected) this.carName = '';
      if (this.carName.length < MAX_NAME) this.carName += e.key.toUpperCase();
    } else return;
    this.nameSelected = false;
    this.cursorClock = 0;
    this.refreshName();
  }

  private refreshName(): void {
    const caret = this.editingName && Math.floor(this.cursorClock / 350) % 2 === 0 ? '_' : '';
    this.nameText.setText((this.carName || (this.editingName ? '' : 'MY CAR')) + caret);
    this.nameText.setTint(!this.editingName ? UI.yellow : this.nameSelected ? UI.cyan : UI.white);
  }

  private pointsLeft(): number {
    const s = this.stats;
    return STAT_BUDGET - (s.speed + s.accel + s.handling + s.weight);
  }

  private changeStat(key: StatKey, delta: number): void {
    const v = this.stats[key] + delta;
    if (v < 1 || v > 5) return;
    if (delta > 0 && this.pointsLeft() <= 0) {
      toast(this, 'NO POINTS LEFT: LOWER ANOTHER STAT', UI.orange);
      return;
    }
    this.stats = { ...this.stats, [key]: v };
    sfx.blip();
    this.refreshStats();
  }

  private refreshStats(): void {
    const left = this.pointsLeft();
    STATS.forEach(([key], i) => {
      const row = this.statRows[i];
      const v = this.stats[key];
      row.pips.forEach((img, k) => img.setTexture(k < v ? 'icon-pip' : 'icon-pipEmpty'));
      row.minus.setEnabled(v > 1);
      row.plus.setEnabled(v < 5 && left > 0);
    });
    this.pointsText.setText(left > 0 ? `${left} POINT${left === 1 ? '' : 'S'} TO SPEND` : 'ALL POINTS SPENT');
    this.pointsText.setTint(left > 0 ? UI.lime : UI.grey);
  }

  // ---------------------------------------------------------------------------
  // Tools, views and refresh
  // ---------------------------------------------------------------------------

  private setTool(t: Tool): void {
    this.tool = t;
    if (t === 'pen' && this.pot === '.') this.pot = 'B';
    this.refreshButtons();
    this.drawPots();
    this.refreshHint();
  }

  private toggleMirror(): void {
    this.mirror = !this.mirror;
    sfx.blip();
    this.refreshButtons();
    this.drawGrid();
    this.refreshHint();
  }

  private setView(v: View): void {
    if (v === this.view) return;
    sfx.blip();
    this.view = v;
    this.stroke = null;
    this.hover = null;
    this.layoutGrid();
    this.refreshAll();
  }

  private refreshButtons(): void {
    (Object.keys(this.tabs) as View[]).forEach((v) => this.tabs[v].setOn(v === this.view));
    (Object.keys(this.tools) as Tool[]).forEach((t) => this.tools[t].setOn(t === this.tool));
    this.mirrorBtn.setText(this.mirror ? 'MIRROR: ON' : 'MIRROR: OFF').setOn(this.mirror);
    this.undoBtn.setEnabled(this.doc.canUndo);
    this.redoBtn.setEnabled(this.doc.canRedo);
    this.deleteBtn?.setEnabled(!this.isNew);
  }

  private setHoverHint(text: string): void {
    if (text === this.hoverHint) return;
    this.hoverHint = text;
    this.refreshHint();
  }

  private refreshHint(): void {
    let t = this.hoverHint;
    if (!t) {
      if (this.editingName) t = 'TYPE A NAME, THEN PRESS ENTER.';
      else if (this.pot === 'p') t = 'PUPILS SLIDE SIDEWAYS WHEN YOU STEER, SO KEEP EYE WHITE ON BOTH SIDES OF THEM.';
      else if (this.tool === 'fill') t = 'FILL POURS PAINT INTO THE AREA YOU CLICK.';
      else if (this.tool === 'pick') t = 'PICK TAKES THE PAINT OF THE PIXEL YOU CLICK.';
      else if (this.view === 'top') t = 'SEEN FROM ABOVE, NOSE UP. THE RACE TURNS IT FOR YOU. RIGHT-CLICK ERASES, TAB SWITCHES VIEW.';
      else t = 'THE FACE USED IN MENUS AND ON THE PODIUM. EYE PIXELS BLINK BY THEMSELVES.';
    }
    this.hint.setText(t);
  }

  private refreshAll(): void {
    this.drawGrid();
    this.drawCursor();
    this.drawPots();
    this.drawColors();
    this.refreshButtons();
    this.refreshName();
    this.refreshStats();
    this.refreshHint();
  }

  private rebuildPreview(): void {
    this.previewDirty = false;
    this.sinceBuild = 0;
    const d = this.design();
    const sheet = buildCarSheet(d);
    const tex = addRaster(this, 'paint-car', sheet.raster);
    for (let look = 0; look < 3; look++) {
      for (let k = 0; k < CAR_DIRECTIONS; k++) tex.add(carFrame(k, look), 0, k * sheet.frame, look * sheet.frame, sheet.frame, sheet.frame);
    }
    const face = buildPortrait(d);
    addRaster(this, 'paint-face', face.open);
    addRaster(this, 'paint-face-blink', face.blink);
    this.spinner.setTexture('paint-car', carFrame(this.dir, 0));
    this.face.setTexture(this.blink > 0 ? 'paint-face-blink' : 'paint-face');
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private key(e: KeyboardEvent): void {
    sfx.unlock();
    if (this.closeModal) return;
    if (this.editingName) {
      this.typeName(e);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ') (e.shiftKey ? this.redo() : this.undo());
      else if (e.code === 'KeyY') this.redo();
      return;
    }
    switch (e.code) {
      case 'Tab':
        this.setView(this.view === 'top' ? 'front' : 'top');
        break;
      case 'KeyP':
      case 'KeyB':
        this.setTool('pen');
        break;
      case 'KeyE':
        this.setTool('erase');
        break;
      case 'KeyF':
        this.setTool('fill');
        break;
      case 'KeyI':
        this.setTool('pick');
        break;
      case 'KeyX':
        this.toggleMirror();
        break;
      case 'KeyZ':
        this.undo();
        break;
      case 'KeyY':
        this.redo();
        break;
      case 'KeyN':
        this.startNameEdit();
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'Escape':
        this.back();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Saving and leaving
  // ---------------------------------------------------------------------------

  private ask(message: string, options: { label: string; action: () => void }[]): void {
    this.cursorGfx.clear();
    const close = dialog(
      this,
      message,
      options.map((o) => ({
        label: o.label,
        action: () => {
          this.closeModal = null;
          o.action();
        },
      })),
    );
    this.closeModal = close;
  }

  /** Validates and stores the car. Returns true when it is safely saved. */
  private save(silent = false): boolean {
    if (this.editingName) this.endNameEdit();
    if (this.docs.top.painted() < 12 || this.docs.front.painted() < 12) {
      toast(this, 'DRAW A LITTLE MORE ON BOTH VIEWS FIRST', UI.orange);
      return false;
    }
    if (this.isNew && customCars().length >= MAX_CUSTOM_CARS) {
      toast(this, `GARAGE FULL: ${MAX_CUSTOM_CARS} CARS. DELETE ONE FIRST`, UI.orange);
      return false;
    }
    if (!this.carName.trim()) this.carName = 'MY CAR';
    const d = this.design();
    if (!saveCustomCar(d)) {
      toast(this, 'THIS BROWSER WOULD NOT SAVE THE CAR', UI.red);
      return false;
    }
    registerCar(this, d);
    this.isNew = false;
    this.modeText.setText('EDITING');
    this.saved = this.snapshot();
    this.refreshButtons();
    if (!silent) {
      sfx.confirm();
      toast(this, `${d.name} IS IN YOUR GARAGE!`, UI.lime);
    }
    return true;
  }

  private race(): void {
    if (!this.save(true)) return;
    sfx.confirm();
    goTo(this, 'select-track', { car: this.carId });
  }

  private copyCode(): void {
    const code = designToCode(this.design());
    console.log(code);
    const failed = () => toast(this, 'COPY BLOCKED: THE CODE IS IN THE CONSOLE', UI.orange);
    try {
      navigator.clipboard.writeText(code).then(() => toast(this, 'COPIED! PASTE INTO SRC/ART/CARS.TS', UI.lime), failed);
    } catch {
      failed();
    }
  }

  private startOver(): void {
    this.ask('START AGAIN FROM ONE OF THE TEAM CARS? YOUR DRAWING AND COLOURS ARE REPLACED.', [
      ...CAR_DESIGNS.map((base) => ({
        label: base.name,
        action: () => {
          this.palette = { ...carPalette(base) };
          this.docs = { top: new PixelDoc(base.top), front: new PixelDoc(base.front) };
          this.layoutGrid();
          this.previewDirty = true;
          this.refreshAll();
        },
      })),
      { label: 'CANCEL', action: () => {} },
    ]);
  }

  private remove(): void {
    if (this.isNew) return;
    this.ask(`DELETE ${this.design().name} FOR GOOD?`, [
      {
        label: 'DELETE',
        action: () => {
          deleteCustomCar(this.carId);
          unregisterCar(this, this.carId);
          sfx.back();
          goTo(this, 'select-car');
        },
      },
      { label: 'CANCEL', action: () => {} },
    ]);
  }

  private back(): void {
    if (this.editingName) this.endNameEdit();
    const leave = () => {
      sfx.back();
      goTo(this, 'select-car', { car: this.isNew ? undefined : this.carId });
    };
    if (!this.dirty) {
      leave();
      return;
    }
    this.ask('SAVE YOUR CHANGES BEFORE LEAVING?', [
      { label: 'SAVE', action: () => this.save(true) && leave() },
      { label: 'DISCARD', action: leave },
      { label: 'CANCEL', action: () => {} },
    ]);
  }
}
