import Phaser from 'phaser';
import { GAME_H, GAME_W, UI, formatTime, ordinal } from '../config.ts';
import { TRACKS } from '../tracks/tracks.ts';
import { sfx } from '../game/audio.ts';
import { panelKey, portraitKey } from '../ui/textures.ts';
import { bindNav, goTo, label, panel, stripes } from '../ui/ui.ts';
import type { RaceResultData } from './RaceScene.ts';
import { RULES } from '../game/difficulty.ts';

const OPTIONS = ['RACE AGAIN', 'TRACKS', 'CARS'];

export class ResultsScene extends Phaser.Scene {
  private result!: RaceResultData;
  private index = 0;
  private buttons: Phaser.GameObjects.Image[] = [];
  private texts: Phaser.GameObjects.BitmapText[] = [];

  constructor() {
    super('results');
  }

  init(data: RaceResultData): void {
    this.result = data;
    this.index = 0;
    this.buttons = [];
    this.texts = [];
  }

  create(): void {
    const d = this.result;
    sfx.music('menu');
    stripes(this, 0x5d275d, 0x67306a);
    const win = d.playerPlace === 1;
    const title = win ? 'YOU WIN!' : `YOU PLACED ${ordinal(d.playerPlace)}`;
    label(this, GAME_W / 2, 8, title, { scale: 3, color: win ? UI.yellow : UI.white, originX: 0.5 });
    const track = TRACKS.find((t) => t.id === d.track);
    label(this, GAME_W / 2, 34, `${track ? track.name : ''}  -  ${RULES[d.difficulty].label}`, { color: UI.pink, originX: 0.5 });

    // podium: 2nd - 1st - 3rd
    const base = 214;
    const podium: [number, number, number][] = [
      [1, 70, 30],
      [0, 140, 46],
      [2, 210, 20],
    ];
    const blockColor = [UI.yellow, 0xc2c8d6, UI.orange];
    for (const [rank, cx, h] of podium) {
      const s = d.standings[rank];
      if (!s) continue;
      this.add.image(cx - 33, base - h, panelKey(this, 66, h + 6, blockColor[rank])).setOrigin(0, 0);
      label(this, cx, base - h + 6, String(rank + 1), { scale: 2, color: UI.ink, shadow: null, originX: 0.5 });
      const face = this.add.image(cx, base - h, portraitKey(s.design, s.alt)).setOrigin(0.5, 1).setScale(2);
      this.tweens.add({ targets: face, y: base - h - (rank === 0 ? 8 : 4), duration: 260, yoyo: true, repeat: -1, ease: 'Quad.Out', delay: rank * 120, repeatDelay: rank === 0 ? 120 : 600 });
      if (rank === 0) {
        const crown = this.add.image(cx, base - h - 60, 'icon-crown').setScale(2);
        this.tweens.add({ targets: crown, y: crown.y - 8, duration: 260, yoyo: true, repeat: -1, ease: 'Quad.Out', repeatDelay: 120 });
      }
      label(this, cx, base + 10, s.name, { color: s.isPlayer ? UI.yellow : UI.white, originX: 0.5 });
    }

    // standings table
    const tx = 262;
    d.standings.forEach((s, i) => {
      const y = 50 + i * 22;
      this.add.image(tx, y, panelKey(this, 206, 20, s.isPlayer ? UI.blue : 0x333c57, s.isPlayer ? UI.yellow : UI.ink)).setOrigin(0, 0);
      label(this, tx + 8, y + 7, ordinal(i + 1), { color: i === 0 ? UI.yellow : UI.white });
      label(this, tx + 38, y + 7, s.name + (s.isPlayer ? ' (YOU)' : ''), { color: s.isPlayer ? UI.yellow : UI.white });
      label(this, tx + 198, y + 7, (s.finished ? '' : '~') + formatTime(s.time), { color: s.finished ? UI.white : UI.grey, originX: 1 });
    });
    const ry = 50 + d.standings.length * 22 + 4;
    panel(this, tx, ry, 206, 34, 0x333c57);
    label(this, tx + 8, ry + 7, `RACE ${formatTime(d.playerTime)}`, { color: UI.white });
    label(this, tx + 8, ry + 20, `BEST LAP ${formatTime(d.bestLap)}`, { color: UI.white });
    if (d.records.race) this.badge(tx + 198, ry + 7, 'RECORD!');
    if (d.records.lap) this.badge(tx + 198, ry + 20, 'RECORD!');

    // buttons
    const bw = 96;
    const bx0 = GAME_W / 2 - (OPTIONS.length * bw + (OPTIONS.length - 1) * 8) / 2;
    OPTIONS.forEach((o, i) => {
      const x = bx0 + i * (bw + 8);
      const b = this.add.image(x, GAME_H - 30, panelKey(this, bw, 20, 0x333c57)).setOrigin(0, 0);
      const t = label(this, x + bw / 2, GAME_H - 23, o, { originX: 0.5 });
      b.setInteractive({ useHandCursor: true });
      b.on('pointerover', () => this.select(i));
      b.on('pointerdown', () => this.choose(i));
      this.buttons.push(b);
      this.texts.push(t);
    });
    this.select(0, true);
    bindNav(this, (a) => {
      if (a === 'left') this.select((this.index + OPTIONS.length - 1) % OPTIONS.length);
      else if (a === 'right') this.select((this.index + 1) % OPTIONS.length);
      else if (a === 'confirm') this.choose(this.index);
      else if (a === 'back') this.choose(2);
    });

    if (d.playerPlace <= 3) {
      const confetti = this.add.particles(0, 0, 'dot', {
        lifespan: 3200,
        speedY: { min: 20, max: 60 },
        speedX: { min: -20, max: 20 },
        x: { min: 0, max: GAME_W },
        y: -4,
        frequency: win ? 40 : 120,
        tint: [UI.yellow, UI.pink, UI.cyan, UI.lime, UI.orange, UI.white],
      });
      confetti.setDepth(50);
    }
    this.cameras.main.fadeIn(250, 26, 28, 44);
  }

  private badge(x: number, y: number, text: string): void {
    const t = label(this, x, y, text, { color: UI.lime, originX: 1 });
    this.tweens.add({ targets: t, alpha: 0.3, duration: 300, yoyo: true, repeat: -1 });
  }

  private select(i: number, silent = false): void {
    if (!silent && i !== this.index) sfx.blip();
    this.index = i;
    this.buttons.forEach((b, k) => {
      b.setTexture(k === i ? panelKey(this, 96, 20, UI.blue, UI.yellow) : panelKey(this, 96, 20, 0x333c57));
      this.texts[k].setTint(k === i ? UI.yellow : UI.white);
    });
  }

  private choose(i: number): void {
    sfx.confirm();
    const d = this.result;
    if (i === 0) {
      sfx.music(null);
      goTo(this, 'race', { car: d.car, track: d.track });
    } else if (i === 1) goTo(this, 'select-track', { car: d.car });
    else goTo(this, 'select-car');
  }
}
