import Phaser from 'phaser';
import { GAME_W, UI, formatTime } from '../config.ts';
import { TRACKS } from '../tracks/tracks.ts';
import { THEMES } from '../tracks/themes.ts';
import { buildGeometry } from '../tracks/geometry.ts';
import { buildMinimap } from '../tracks/minimap.ts';
import { sfx } from '../game/audio.ts';
import { bestRace, getDifficulty, lastChoice, setDifficulty } from '../game/save.ts';
import { DIFFICULTIES, RULES, type Difficulty } from '../game/difficulty.ts';
import { addRaster, panelKey } from '../ui/textures.ts';
import { bindNav, button, cardRow, goTo, label, stripes, type Button } from '../ui/ui.ts';

const CARD_H = 178;
const CARD_Y = 34;

interface Card {
  bg: Phaser.GameObjects.Image;
  parts: Phaser.GameObjects.GameObject[];
  map: Phaser.GameObjects.Image;
}

export class TrackSelectScene extends Phaser.Scene {
  private car = 'zippy';
  private index = 0;
  private cards: Card[] = [];
  private blurb!: Phaser.GameObjects.BitmapText;
  private cardW = 146;
  private difficulty: Difficulty = 'medium';
  /** Each card's best time, which depends on the difficulty. */
  private bests: Phaser.GameObjects.BitmapText[] = [];
  private levelButtons: Button[] = [];
  private levelBlurb!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('select-track');
  }

  init(data: { car?: string }): void {
    this.car = data.car ?? 'zippy';
  }

  create(): void {
    this.cards = [];
    this.bests = [];
    this.levelButtons = [];
    this.difficulty = getDifficulty();
    this.index = Math.max(0, TRACKS.findIndex((t) => t.id === lastChoice().track));
    stripes(this, 0x257179, 0x2a7f86);
    label(this, GAME_W / 2, 10, 'CHOOSE A TRACK', { scale: 2, color: UI.yellow, originX: 0.5 });

    const row = cardRow(TRACKS.length);
    const CARD_W = (this.cardW = row.w);
    TRACKS.forEach((t, i) => {
      const x = row.x(i);
      const theme = THEMES[t.theme];
      const bg = this.add.image(x, CARD_Y, panelKey(this, CARD_W, CARD_H, 0x333c57)).setOrigin(0, 0);
      const preview = this.add.image(x + 6, CARD_Y + 6, panelKey(this, CARD_W - 12, 88, theme.map.bg, UI.ink)).setOrigin(0, 0);
      const key = `preview-${t.id}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      addRaster(this, key, buildMinimap(buildGeometry(t, false), CARD_W - 24, 76, 3).raster);
      const map = this.add.image(x + CARD_W / 2, CARD_Y + 50, key);
      const words = t.name.split(' ');
      const parts: Phaser.GameObjects.GameObject[] = [preview, map];
      const big = words.every((w) => w.length * 12 <= CARD_W - 8);
      words.forEach((w, k) => parts.push(label(this, x + CARD_W / 2, CARD_Y + 100 + k * 16, w, { scale: big ? 2 : 1, originX: 0.5 })));
      for (let s = 0; s < 3; s++) {
        parts.push(this.add.image(x + CARD_W / 2 - 10 + s * 10, CARD_Y + 140, s < t.difficulty ? 'icon-star' : 'icon-starEmpty'));
      }
      parts.push(label(this, x + CARD_W / 2, CARD_Y + 150, `${t.laps} LAPS  ${theme.label}`, { color: UI.grey, originX: 0.5 }));
      const best = label(this, x + CARD_W / 2, CARD_Y + 162, '', { originX: 0.5 });
      this.bests.push(best);
      parts.push(best);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => this.select(i));
      bg.on('pointerdown', () => {
        sfx.unlock();
        if (this.index === i) this.confirm();
        else this.select(i);
      });
      this.cards.push({ bg, parts, map });
    });

    this.blurb = label(this, GAME_W / 2, 217, '', { originX: 0.5 });

    // difficulty: easier levels slow the rivals and charge your nitro faster
    const bw = 58;
    const x0 = GAME_W / 2 - (DIFFICULTIES.length * bw + (DIFFICULTIES.length - 1) * 6) / 2;
    DIFFICULTIES.forEach((d, i) => {
      this.levelButtons.push(button(this, x0 + i * (bw + 6), 228, bw, 13, RULES[d].label, () => this.setLevel(d)));
    });
    this.levelBlurb = label(this, GAME_W / 2, 245, '', { color: UI.grey, originX: 0.5 });
    this.setLevel(this.difficulty, true);

    label(this, GAME_W / 2, 258, '< >  TRACK    ^ v  LEVEL    ENTER  RACE    ESC  BACK', { color: UI.grey, originX: 0.5 });
    bindNav(this, (a) => {
      if (a === 'left') this.select((this.index + TRACKS.length - 1) % TRACKS.length);
      else if (a === 'right') this.select((this.index + 1) % TRACKS.length);
      else if (a === 'up' || a === 'down') {
        const i = DIFFICULTIES.indexOf(this.difficulty) + (a === 'up' ? 1 : -1);
        if (i >= 0 && i < DIFFICULTIES.length) this.setLevel(DIFFICULTIES[i]);
      }
      else if (a === 'confirm') this.confirm();
      else if (a === 'back') {
        sfx.back();
        goTo(this, 'select-car');
      }
    });
    this.select(this.index, true);
    this.cameras.main.fadeIn(200, 26, 28, 44);
  }

  private select(i: number, silent = false): void {
    if (i === this.index && !silent) return;
    if (!silent) sfx.blip();
    this.index = i;
    this.cards.forEach((c, k) => {
      const on = k === i;
      c.bg.setTexture(on ? panelKey(this, this.cardW, CARD_H, UI.blue, UI.yellow) : panelKey(this, this.cardW, CARD_H, 0x333c57));
      for (const p of c.parts) (p as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(on ? 1 : 0.6);
      this.tweens.killTweensOf(c.map);
      c.map.setScale(1);
      if (on) this.tweens.add({ targets: c.map, scale: 1.06, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    });
    this.blurb.setText(TRACKS[i].blurb.toUpperCase());
  }

  /** Picks a difficulty: remembers it and shows each track's best time for it. */
  private setLevel(d: Difficulty, silent = false): void {
    if (!silent) sfx.blip();
    this.difficulty = d;
    setDifficulty(d);
    DIFFICULTIES.forEach((k, i) => this.levelButtons[i].setOn(k === d));
    this.levelBlurb.setText(RULES[d].blurb);
    TRACKS.forEach((t, i) => {
      const best = bestRace(t.id, d);
      this.bests[i].setText(best ? `BEST ${formatTime(best.time)}` : 'BEST -:--.--').setTint(best ? UI.yellow : UI.slate);
    });
  }

  private confirm(): void {
    sfx.confirm();
    sfx.music(null);
    goTo(this, 'race', { car: this.car, track: TRACKS[this.index].id });
  }
}
