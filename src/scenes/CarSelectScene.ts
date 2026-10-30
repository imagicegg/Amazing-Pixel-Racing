import Phaser from 'phaser';
import { GAME_W, UI } from '../config.ts';
import { CAR_DESIGNS, type CarDesign } from '../art/cars.ts';
import { sfx } from '../game/audio.ts';
import { lastChoice } from '../game/save.ts';
import { MAX_CUSTOM_CARS, allCars, customCars, isCustom } from '../game/customCars.ts';
import { panelKey, portraitKey } from '../ui/textures.ts';
import { bindNav, button, goTo, label, onUpdate, stripes, toast } from '../ui/ui.ts';

const CARD_W = 111;
const CARD_H = 178;
const CARD_Y = 34;
const GAP = 8;

interface Card {
  /** null for the "new car" card at the end. */
  design: CarDesign | null;
  bg: Phaser.GameObjects.Image;
  face: Phaser.GameObjects.Image | null;
  parts: Phaser.GameObjects.GameObject[];
  blink: number;
  bounce: Phaser.Tweens.Tween | null;
}

/** Car picker: a scrolling row of cards, with the paint shop as the last card. */
export class CarSelectScene extends Phaser.Scene {
  private index = 0;
  private cards: Card[] = [];
  private row!: Phaser.GameObjects.Container;
  private arrows!: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private tagline!: Phaser.GameObjects.BitmapText;
  private help!: Phaser.GameObjects.BitmapText;
  private preferred = '';

  constructor() {
    super('select-car');
  }

  init(data: { car?: string }): void {
    this.preferred = data.car ?? lastChoice().car;
  }

  create(): void {
    sfx.music('menu');
    this.cards = [];
    stripes(this, 0x29366f, 0x2e3c7c);
    label(this, GAME_W / 2, 10, 'CHOOSE YOUR RACER', { scale: 2, color: UI.yellow, originX: 0.5 });

    this.row = this.add.container(0, 0);
    const cars = allCars();
    cars.forEach((d, i) => this.cards.push(this.carCard(d, i)));
    this.cards.push(this.newCarCard(cars.length));
    this.index = Math.max(0, cars.findIndex((d) => d.id === this.preferred));

    this.arrows = [
      this.add.image(4, CARD_Y + CARD_H / 2, 'icon-arrowRight').setFlipX(true).setScale(2),
      this.add.image(GAME_W - 4, CARD_Y + CARD_H / 2, 'icon-arrowRight').setScale(2),
    ];
    this.tagline = label(this, GAME_W / 2, 222, '', { color: UI.white, originX: 0.5 });
    this.help = label(this, GAME_W / 2, 252, '', { color: UI.grey, originX: 0.5 });

    bindNav(this, (a) => {
      const n = this.cards.length;
      if (a === 'left') this.select((this.index + n - 1) % n);
      else if (a === 'right') this.select((this.index + 1) % n);
      else if (a === 'confirm') this.confirm();
      else if (a === 'alt') this.edit();
      else if (a === 'back') {
        sfx.back();
        goTo(this, 'title');
      }
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number) => {
      const n = this.cards.length;
      const step = Math.sign(dy || dx);
      if (step) this.select((this.index + step + n) % n);
    });
    onUpdate(this, (_t, dms) => {
      for (const c of this.cards) {
        if (!c.design || !c.face) continue;
        c.blink -= dms;
        if (c.blink <= 0 && Math.random() < 0.005) c.blink = 120;
        c.face.setTexture(portraitKey(c.design, false, c.blink > 0));
      }
    });
    this.select(this.index, { silent: true, instant: true });
    this.cameras.main.fadeIn(200, 26, 28, 44);
  }

  private cardX(i: number): number {
    return i * (CARD_W + GAP);
  }

  private addCardBase(i: number): Phaser.GameObjects.Image {
    const bg = this.add.image(this.cardX(i), CARD_Y, panelKey(this, CARD_W, CARD_H, 0x333c57)).setOrigin(0, 0);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => this.select(i, { scroll: false }));
    bg.on('pointerdown', () => {
      sfx.unlock();
      if (this.index === i) this.confirm();
      else this.select(i);
    });
    this.row.add(bg);
    return bg;
  }

  private carCard(d: CarDesign, i: number): Card {
    const x = this.cardX(i);
    const bg = this.addCardBase(i);
    const face = this.add.image(x + CARD_W / 2, CARD_Y + 86, portraitKey(d, false)).setOrigin(0.5, 1).setScale(3);
    const big = d.name.length * 12 <= CARD_W - 10;
    const name = label(this, x + CARD_W / 2, CARD_Y + (big ? 94 : 97), d.name, { scale: big ? 2 : 1, originX: 0.5 });
    const parts: Phaser.GameObjects.GameObject[] = [face, name];
    const stats: [string, number][] = [
      ['SPEED', d.stats.speed],
      ['ACCEL', d.stats.accel],
      ['HANDLING', d.stats.handling],
      ['WEIGHT', d.stats.weight],
    ];
    stats.forEach(([n, v], row) => {
      const y = CARD_Y + 118 + row * 13;
      parts.push(label(this, x + 7, y, n, { color: UI.grey }));
      for (let p = 0; p < 5; p++) parts.push(this.add.image(x + CARD_W - 40 + p * 7, y + 3, p < v ? 'icon-pip' : 'icon-pipEmpty'));
    });
    if (isCustom(d.id)) {
      parts.push(label(this, x + 6, CARD_Y + 6, 'MINE', { color: UI.lime }));
      const edit = button(this, x + CARD_W - 32, CARD_Y + 4, 28, 12, 'EDIT', () => {
        this.index = i;
        this.edit();
      });
      parts.push(edit.bg, edit.text);
    }
    this.row.add(parts);
    return { design: d, bg, face, parts, blink: 0, bounce: null };
  }

  private newCarCard(i: number): Card {
    const x = this.cardX(i);
    const bg = this.addCardBase(i);
    const full = customCars().length >= MAX_CUSTOM_CARS;
    const icon = this.add.image(x + CARD_W / 2, CARD_Y + 52, 'icon-palette').setScale(3);
    const parts: Phaser.GameObjects.GameObject[] = [
      icon,
      label(this, x + CARD_W / 2, CARD_Y + 88, 'NEW CAR', { scale: 2, originX: 0.5, color: UI.yellow }),
      label(this, x + CARD_W / 2, CARD_Y + 110, 'PAINT SHOP', { originX: 0.5, color: UI.grey }),
    ];
    const blurb = label(this, x + CARD_W / 2, CARD_Y + 130, full ? 'GARAGE FULL: EDIT OR DELETE A CAR' : 'DRAW YOUR OWN RACER, PIXEL BY PIXEL', {
      originX: 0.5,
      color: full ? UI.orange : UI.white,
    });
    blurb.setMaxWidth(CARD_W - 14).setCenterAlign();
    parts.push(blurb);
    this.tweens.add({ targets: icon, angle: { from: -8, to: 8 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.row.add(parts);
    return { design: null, bg, face: null, parts, blink: 0, bounce: null };
  }

  private select(i: number, opts: { silent?: boolean; scroll?: boolean; instant?: boolean } = {}): void {
    const changed = i !== this.index;
    if (!changed && !opts.silent && opts.scroll === false) return;
    if (changed && !opts.silent) sfx.blip();
    this.index = i;
    this.cards.forEach((c, k) => {
      const on = k === i;
      c.bg.setTexture(on ? panelKey(this, CARD_W, CARD_H, UI.blue, UI.yellow) : panelKey(this, CARD_W, CARD_H, 0x333c57));
      for (const p of c.parts) (p as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(on ? 1 : 0.6);
      if (c.face) {
        c.bounce?.stop();
        c.face.y = CARD_Y + 86;
        c.bounce = on ? this.tweens.add({ targets: c.face, y: CARD_Y + 80, duration: 260, yoyo: true, repeat: -1, ease: 'Quad.Out', repeatDelay: 140 }) : null;
      }
    });
    const card = this.cards[i];
    const d = card.design;
    this.tagline.setText(d ? d.tagline.toUpperCase() : 'DESIGN A CAR AND RACE IT');
    const edit = d ? (isCustom(d.id) ? '    E  EDIT' : '    E  REPAINT') : '';
    this.help.setText(`< >  CHOOSE    ENTER  ${d ? 'GO' : 'OPEN'}${edit}    ESC  BACK`);
    if (opts.scroll !== false) this.scrollTo(i, !!opts.instant);
  }

  /** Slides the row so the selected card is on screen. */
  private scrollTo(i: number, instant: boolean): void {
    const n = this.cards.length;
    const total = n * CARD_W + (n - 1) * GAP;
    let x: number;
    if (total <= GAME_W - 12) x = Math.round((GAME_W - total) / 2);
    else {
      x = Math.round(GAME_W / 2 - (this.cardX(i) + CARD_W / 2));
      x = Math.max(GAME_W - 6 - total, Math.min(6, x));
    }
    this.tweens.killTweensOf(this.row);
    if (instant) this.row.x = x;
    else this.tweens.add({ targets: this.row, x, duration: 220, ease: 'Quad.Out' });
    this.arrows[0].setVisible(x < 6);
    this.arrows[1].setVisible(x + total > GAME_W - 6);
  }

  private confirm(): void {
    const d = this.cards[this.index].design;
    if (!d) {
      if (customCars().length >= MAX_CUSTOM_CARS) {
        toast(this, 'GARAGE FULL: EDIT OR DELETE A CAR FIRST', UI.orange);
        return;
      }
      sfx.confirm();
      goTo(this, 'paint', { base: CAR_DESIGNS[0].id });
      return;
    }
    sfx.confirm();
    goTo(this, 'select-track', { car: d.id });
  }

  /** E / gamepad Y: edit a custom car, or start a new one from a team car. */
  private edit(): void {
    const d = this.cards[this.index].design;
    if (!d) {
      this.confirm();
      return;
    }
    if (!isCustom(d.id) && customCars().length >= MAX_CUSTOM_CARS) {
      toast(this, 'GARAGE FULL: EDIT OR DELETE A CAR FIRST', UI.orange);
      return;
    }
    sfx.confirm();
    goTo(this, 'paint', isCustom(d.id) ? { edit: d.id } : { base: d.id });
  }
}
