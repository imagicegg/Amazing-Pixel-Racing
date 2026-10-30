import Phaser from 'phaser';
import { GAME_H, GAME_W, UI } from '../config.ts';
import { CAR_DESIGNS } from '../art/cars.ts';
import { sfx } from '../game/audio.ts';
import { portraitKey } from '../ui/textures.ts';
import { bindNav, goTo, label, onUpdate, stripes } from '../ui/ui.ts';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create(): void {
    sfx.music('menu');
    stripes(this, 0x41a6f6, 0x56b4f8);

    // grassy hill the cars stand on
    const ground = this.add.graphics();
    ground.fillStyle(0x38b764, 1).fillRect(0, 214, GAME_W, GAME_H - 214);
    ground.fillStyle(0xa7f070, 1).fillRect(0, 214, GAME_W, 2);
    ground.fillStyle(0x257179, 1).fillRect(0, 226, GAME_W, 1);
    for (let x = 0; x < GAME_W; x += 7) ground.fillStyle(0x2f9a5a, 1).fillRect(x + ((x * 13) % 5), 220 + ((x * 7) % 9), 2, 1);

    // bouncy rainbow logo, one sprite per letter
    const word = 'TINY TURBO';
    const colors = [UI.yellow, UI.orange, UI.pink, UI.lime, 0, UI.cyan, UI.yellow, UI.orange, UI.pink, UI.lime];
    const scale = 5;
    const step = 6 * scale;
    const startX = GAME_W / 2 - (word.length * step) / 2 + step / 2;
    [...word].forEach((ch, i) => {
      if (ch === ' ') return;
      const t = label(this, startX + i * step, 46, ch, { scale, color: colors[i], originX: 0.5, originY: 0.5 });
      this.tweens.add({ targets: t, y: 40, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 70 });
    });
    const ribbon = this.add.graphics();
    ribbon.fillStyle(UI.ink, 1).fillRect(GAME_W / 2 - 74, 70, 148, 20);
    ribbon.fillStyle(UI.red, 1).fillRect(GAME_W / 2 - 73, 71, 146, 18);
    ribbon.fillStyle(0xff6b72, 1).fillRect(GAME_W / 2 - 73, 71, 146, 2);
    label(this, GAME_W / 2, 74, 'GRAND PRIX', { scale: 2, originX: 0.5 });
    this.add.image(GAME_W / 2 - 92, 80, 'icon-flag').setScale(2);
    this.add.image(GAME_W / 2 + 92, 80, 'icon-flag').setScale(2).setFlipX(true);

    // the three racers say hello
    const faces = CAR_DESIGNS.map((d, i) => {
      const x = GAME_W / 2 + (i - (CAR_DESIGNS.length - 1) / 2) * 124;
      const img = this.add.image(x, 214, portraitKey(d, false)).setOrigin(0.5, 1).setScale(3);
      this.tweens.add({ targets: img, y: 206, duration: 300, yoyo: true, repeat: -1, ease: 'Quad.Out', delay: i * 180, repeatDelay: 500 });
      return { img, d, blink: 0 };
    });
    onUpdate(this, (_t, dms) => {
      for (const f of faces) {
        f.blink -= dms;
        if (f.blink <= 0 && Math.random() < 0.006) f.blink = 130;
        f.img.setTexture(portraitKey(f.d, false, f.blink > 0));
      }
    });

    const touch = this.sys.game.device.input.touch;
    const prompt = label(this, GAME_W / 2, 236, touch ? 'TAP TO START' : 'PRESS ENTER TO START', { scale: 2, color: UI.white, originX: 0.5 });
    this.tweens.add({ targets: prompt, alpha: 0.25, duration: 500, yoyo: true, repeat: -1 });
    label(this, GAME_W / 2, 258, 'ARROWS/WASD DRIVE  SPACE DRIFT  C NITRO  V VIEW  M SOUND', { color: 0xc4f4ff, originX: 0.5 });

    const start = () => {
      sfx.unlock();
      sfx.confirm();
      goTo(this, 'select-car');
    };
    bindNav(this, (a) => {
      if (a === 'confirm') start();
    });
    this.input.once('pointerdown', start);
    this.cameras.main.fadeIn(300, 26, 28, 44);
  }
}
