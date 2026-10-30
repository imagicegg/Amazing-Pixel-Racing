// Driving controls from keyboard, gamepad and (on touch screens) on-screen buttons.
import Phaser from 'phaser';
import type { Controls } from './physics.ts';
import { firstPad, label } from '../ui/ui.ts';
import { GAME_H, GAME_W, UI } from '../config.ts';

type KeyName = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'W' | 'A' | 'S' | 'D' | 'X' | 'Z' | 'SPACE' | 'SHIFT' | 'C' | 'ESC' | 'P' | 'V' | 'R' | 'F' | 'G';

interface TouchButton {
  zone: Phaser.Geom.Rectangle;
  img: Phaser.GameObjects.Image;
  down: boolean;
}

export class RaceInput {
  private keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private touch: Record<'left' | 'right' | 'gas' | 'brake' | 'drift' | 'nitro' | 'missile' | 'shield', TouchButton> | null = null;
  private padStartHeld = false;
  private padViewHeld = false;
  private padResetHeld = false;
  private readonly out: Controls = { throttle: 0, steer: 0, drift: false, nitro: false, missile: false, shield: false };
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.keys = scene.input.keyboard!.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,X,Z,SPACE,SHIFT,C,ESC,P,V,R,F,G') as Record<KeyName, Phaser.Input.Keyboard.Key>;
    if (scene.sys.game.device.input.touch) this.buildTouch();
  }

  private buildTouch(): void {
    const s = this.scene;
    s.input.addPointer(3);
    const make = (key: string, x: number, y: number, w: number, h: number, icon: string, text = '', flip = false): TouchButton => {
      const img = s.add.image(x, y, key).setScrollFactor(0).setDepth(60).setAlpha(0.45);
      const ic = s.add.image(x, y, icon).setScrollFactor(0).setDepth(61).setAlpha(0.8).setFlipX(flip);
      ic.setScale(2);
      img.setData('icon', ic);
      if (text) label(s, x, y - h / 2 - 9, text, { originX: 0.5, color: UI.white }).setScrollFactor(0).setDepth(61).setAlpha(0.8);
      return { zone: new Phaser.Geom.Rectangle(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12), img, down: false };
    };
    const disc = this.discTexture(36);
    const big = this.discTexture(46);
    this.touch = {
      left: make(disc, 34, GAME_H - 30, 36, 36, 'icon-arrowRight', '', true),
      right: make(disc, 82, GAME_H - 30, 36, 36, 'icon-arrowRight'),
      gas: make(big, GAME_W - 36, GAME_H - 36, 46, 46, 'icon-arrowRight', 'GAS'),
      brake: make(disc, GAME_W - 92, GAME_H - 26, 36, 36, 'icon-lightRed', 'BRAKE'),
      drift: make(disc, GAME_W - 36, GAME_H - 104, 36, 36, 'icon-star', 'DRIFT'),
      nitro: make(disc, GAME_W - 92, GAME_H - 80, 36, 36, 'icon-arrowRight', 'NITRO'),
      missile: make(disc, GAME_W - 36, GAME_H - 160, 36, 36, 'item-rocket', 'MISSILE'),
      shield: make(disc, GAME_W - 92, GAME_H - 134, 36, 36, 'item-bubble', 'SHIELD'),
    };
    (this.touch.missile.img.getData('icon') as Phaser.GameObjects.Image).setScale(1.5);
    (this.touch.nitro.img.getData('icon') as Phaser.GameObjects.Image).setAngle(-90);
    this.touch.gas.img.setAngle(-90);
    (this.touch.gas.img.getData('icon') as Phaser.GameObjects.Image).setAngle(-90);
  }

  private discTexture(d: number): string {
    const key = `touch-disc-${d}`;
    if (!this.scene.textures.exists(key)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(UI.ink, 1).fillCircle(d / 2, d / 2, d / 2);
      g.fillStyle(UI.white, 1).fillCircle(d / 2, d / 2, d / 2 - 2);
      g.generateTexture(key, d, d);
      g.destroy();
    }
    return key;
  }

  read(): Controls {
    const k = this.keys;
    let gas = k.UP.isDown || k.W.isDown || k.X.isDown ? 1 : 0;
    let brake = k.DOWN.isDown || k.S.isDown || k.Z.isDown;
    let steer = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
    let drift = k.SPACE.isDown || k.SHIFT.isDown;
    let nitro = k.C.isDown;
    let missile = k.F.isDown;
    let shield = k.G.isDown;

    const pad = firstPad(this.scene);
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      gas = Math.max(gas, pad.A ? 1 : rt > 0.1 ? rt : 0);
      brake = brake || pad.B || (pad.buttons[6]?.value ?? 0) > 0.2;
      nitro = nitro || pad.X;
      // LB fires the missile and d-pad up puts the shield up; RB drifts
      missile = missile || pad.L1 > 0.5;
      shield = shield || pad.up;
      const ax = pad.axes.length ? pad.axes[0].getValue() : 0;
      if (Math.abs(ax) > 0.2) steer = Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.2) / 0.7);
      if (pad.left) steer = -1;
      if (pad.right) steer = 1;
      drift = drift || pad.R1 > 0.5;
    }

    if (this.touch) {
      const t = this.touch;
      for (const b of Object.values(t)) b.down = false;
      for (const p of this.scene.input.manager.pointers) {
        if (!p.isDown) continue;
        for (const b of Object.values(t)) if (b.zone.contains(p.x, p.y)) b.down = true;
      }
      for (const b of Object.values(t)) b.img.setAlpha(b.down ? 0.8 : 0.45);
      if (t.gas.down) gas = 1;
      if (t.brake.down) brake = true;
      if (t.left.down) steer = -1;
      if (t.right.down) steer = 1;
      if (t.drift.down) drift = true;
      if (t.nitro.down) nitro = true;
      if (t.missile.down) missile = true;
      if (t.shield.down) shield = true;
    }

    this.out.throttle = brake ? -1 : gas;
    this.out.steer = steer;
    this.out.drift = drift;
    this.out.nitro = nitro;
    this.out.missile = missile;
    this.out.shield = shield;
    return this.out;
  }

  /** True once per press of Esc / P / gamepad Start. */
  pausePressed(): boolean {
    const k = this.keys;
    let hit = Phaser.Input.Keyboard.JustDown(k.ESC) || Phaser.Input.Keyboard.JustDown(k.P);
    const pad = firstPad(this.scene);
    const start = pad?.buttons[9]?.pressed ?? false;
    if (start && !this.padStartHeld) hit = true;
    this.padStartHeld = start;
    return hit;
  }

  /** True once per press of V / gamepad Y: switch between top and chase view. */
  viewPressed(): boolean {
    let hit = Phaser.Input.Keyboard.JustDown(this.keys.V);
    const y = firstPad(this.scene)?.Y ?? false;
    if (y && !this.padViewHeld) hit = true;
    this.padViewHeld = y;
    return hit;
  }

  /** True once per press of R / gamepad Back: put the car back on the track. */
  resetPressed(): boolean {
    let hit = Phaser.Input.Keyboard.JustDown(this.keys.R);
    const back = firstPad(this.scene)?.buttons[8]?.pressed ?? false;
    if (back && !this.padResetHeld) hit = true;
    this.padResetHeld = back;
    return hit;
  }

  /** Whether the on-screen touch buttons are shown. */
  get hasTouch(): boolean {
    return this.touch !== null;
  }
}
