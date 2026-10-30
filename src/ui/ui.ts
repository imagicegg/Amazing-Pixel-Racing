// Small UI toolkit: pixel labels, panels, menu navigation and scene fades.
import Phaser from 'phaser';
import { FONT, GAME_H, GAME_W, UI } from '../config.ts';
import { sfx } from '../game/audio.ts';
import { getMuted, setMuted } from '../game/save.ts';
import { panelKey } from './textures.ts';

export interface LabelOpts {
  color?: number;
  /** Integer scale keeps the pixels square. */
  scale?: number;
  originX?: number;
  originY?: number;
  shadow?: number | null;
}

export function label(scene: Phaser.Scene, x: number, y: number, text: string, opts: LabelOpts = {}): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(Math.round(x), Math.round(y), FONT, text.toUpperCase(), 7 * (opts.scale ?? 1));
  // Phaser does not round glyph quads, so a centred label with an odd width
  // would sit on half pixels and lose a column of each glyph. Keep the
  // display origin on whole pixels whenever it is recomputed.
  const raw = t.updateDisplayOrigin.bind(t);
  const o = t as unknown as { _displayOriginX: number; _displayOriginY: number };
  t.updateDisplayOrigin = () => {
    raw();
    o._displayOriginX = Math.round(o._displayOriginX);
    o._displayOriginY = Math.round(o._displayOriginY);
    return t;
  };
  t.setOrigin(opts.originX ?? 0, opts.originY ?? 0);
  t.setTint(opts.color ?? UI.white);
  if (opts.shadow !== null) t.setDropShadow(opts.scale && opts.scale > 1 ? opts.scale : 1, opts.scale && opts.scale > 1 ? opts.scale : 1, opts.shadow ?? UI.ink, 1);
  return t;
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill: number = UI.night, border: number = UI.ink): Phaser.GameObjects.Image {
  return scene.add.image(Math.round(x), Math.round(y), panelKey(scene, w, h, fill, border)).setOrigin(0, 0);
}

export type Nav = 'left' | 'right' | 'up' | 'down' | 'confirm' | 'back' | 'alt';

const KEYMAP: { [code: string]: Nav } = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  KeyZ: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  KeyX: 'back',
  KeyE: 'alt',
};

/** Runs fn every frame until the scene shuts down (scene emitters survive restarts). */
export function onUpdate(scene: Phaser.Scene, fn: (time: number, delta: number) => void): void {
  scene.events.on('update', fn);
  scene.events.once('shutdown', () => scene.events.off('update', fn));
}

/** Routes keyboard and gamepad menu input to `cb`. Also handles M (mute) and audio unlock. */
export function bindNav(scene: Phaser.Scene, cb: (a: Nav) => void): void {
  const kb = scene.input.keyboard!;
  const onKey = (e: KeyboardEvent) => {
    sfx.unlock();
    if (e.code === 'KeyM') {
      toggleMute();
      return;
    }
    const a = KEYMAP[e.code];
    if (a && !e.repeat) cb(a);
  };
  kb.on('keydown', onKey);
  scene.events.once('shutdown', () => kb.off('keydown', onKey));
  scene.input.on('pointerdown', () => sfx.unlock());

  // gamepad: edge-detect buttons and the left stick
  const held: { [k: string]: boolean } = {};
  onUpdate(scene, () => {
    const pad = firstPad(scene);
    if (!pad) return;
    const ax = pad.axes.length ? pad.axes[0].getValue() : 0;
    const ay = pad.axes.length > 1 ? pad.axes[1].getValue() : 0;
    const state: { [k in Nav]: boolean } = {
      left: pad.left || ax < -0.6,
      right: pad.right || ax > 0.6,
      up: pad.up || ay < -0.6,
      down: pad.down || ay > 0.6,
      confirm: pad.A || (pad.buttons[9]?.pressed ?? false),
      back: pad.B,
      alt: pad.Y,
    };
    for (const k of Object.keys(state) as Nav[]) {
      if (state[k] && !held[k]) {
        sfx.unlock();
        cb(k);
      }
      held[k] = state[k];
    }
  });
}

export function firstPad(scene: Phaser.Scene): Phaser.Input.Gamepad.Gamepad | null {
  const gp = scene.input.gamepad;
  if (!gp || gp.total === 0) return null;
  return gp.gamepads.find((p) => p && p.connected) ?? null;
}

export function toggleMute(): void {
  const m = !sfx.isMuted;
  sfx.setMuted(m);
  setMuted(m);
}

export function initMute(): void {
  sfx.setMuted(getMuted());
}

/** Horizontal row of menu cards that always fits the screen, however many items there are. */
export function cardRow(count: number, maxW = 146, gap = 8): { w: number; x: (i: number) => number } {
  const w = Math.min(maxW, Math.floor((GAME_W - 12 - (count - 1) * gap) / count));
  const x0 = Math.round((GAME_W - (count * w + (count - 1) * gap)) / 2);
  return { w, x: (i) => x0 + i * (w + gap) };
}

/** Fade out (every camera, so a separate HUD camera fades too), then start another scene. */
/** Scenes already fading out to another scene (so a second press does nothing). */
const leaving = new WeakSet<Phaser.Scene>();

export function goTo(scene: Phaser.Scene, key: string, data?: object): void {
  if (leaving.has(scene)) return;
  leaving.add(scene);
  scene.events.once('shutdown', () => leaving.delete(scene));
  scene.input.keyboard?.removeAllListeners();
  // Fade the cameras that are drawing, and wait for one of them: Phaser runs
  // no effects on a hidden camera (the race hides its world camera in the
  // chase view), so a fade there would never finish.
  const shown = scene.cameras.cameras.filter((c) => c.visible);
  if (!shown.length) {
    scene.scene.start(key, data);
    return;
  }
  for (const c of shown) c.fadeOut(180, 26, 28, 44);
  shown[0].once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => scene.scene.start(key, data));
}

/** Scrolling diagonal stripes, used as a menu background. */
export function stripes(scene: Phaser.Scene, a: number, b: number): Phaser.GameObjects.TileSprite {
  const key = `stripes-${a.toString(16)}-${b.toString(16)}`;
  if (!scene.textures.exists(key)) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    const hexs = (v: number) => '#' + v.toString(16).padStart(6, '0');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        ctx.fillStyle = (x + y) % 32 < 16 ? hexs(a) : hexs(b);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    scene.textures.addCanvas(key, c);
  }
  const ts = scene.add.tileSprite(0, 0, scene.scale.width, scene.scale.height, key).setOrigin(0, 0);
  onUpdate(scene, (_t: number, dt: number) => {
    ts.tilePositionX += dt * 0.012;
    ts.tilePositionY += dt * 0.012;
  });
  return ts;
}

/** Blends two 0xRRGGBB colours. */
export function mixRGB(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export interface Button {
  readonly bg: Phaser.GameObjects.Image;
  readonly text: Phaser.GameObjects.BitmapText;
  /** Highlighted (selected tool, active tab...). */
  setOn(on: boolean): Button;
  setEnabled(enabled: boolean): Button;
  setText(text: string): Button;
}

/** A clickable pixel panel with a centred label. */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onClick: () => void,
  fill = 0x333c57,
): Button {
  let on = false;
  let enabled = true;
  let hover = false;
  const bg = scene.add.image(x, y, panelKey(scene, w, h, fill)).setOrigin(0, 0);
  const t = label(scene, x + w / 2, y + Math.floor((h - 7) / 2), text, { originX: 0.5 });
  const paint = () => {
    const f = on ? UI.blue : hover && enabled ? mixRGB(fill, UI.white, 0.15) : fill;
    bg.setTexture(panelKey(scene, w, h, f, on ? UI.yellow : UI.ink));
    t.setTint(on ? UI.yellow : UI.white);
    bg.setAlpha(enabled ? 1 : 0.4);
    t.setAlpha(enabled ? 1 : 0.4);
  };
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => {
    hover = true;
    paint();
  });
  bg.on('pointerout', () => {
    hover = false;
    paint();
  });
  bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (!enabled || p.rightButtonDown()) return;
    sfx.unlock();
    onClick();
  });
  const api: Button = {
    bg,
    text: t,
    setOn(v) {
      on = v;
      paint();
      return api;
    },
    setEnabled(v) {
      enabled = v;
      paint();
      return api;
    },
    setText(s) {
      t.setText(s.toUpperCase());
      return api;
    },
  };
  return api;
}

/** A short message that pops up in the middle of the screen and fades away. */
export function toast(scene: Phaser.Scene, text: string, color: number = UI.white): void {
  scene.children.getByName('toast')?.destroy();
  const t = label(scene, GAME_W / 2, GAME_H / 2 + 54, text, { originX: 0.5, color });
  const w = Math.max(60, t.width + 20);
  const bg = panel(scene, GAME_W / 2 - Math.round(w / 2), GAME_H / 2 + 48, Math.round(w), 19, UI.ink, UI.yellow);
  const box = scene.add.container(0, 0, [bg, t]).setDepth(400).setName('toast');
  scene.tweens.add({ targets: box, alpha: 0, delay: 1500, duration: 300, onComplete: () => box.destroy() });
}

export interface DialogOption {
  label: string;
  action: () => void;
}

/**
 * Modal question with buttons. Enter picks the first option, Esc the last
 * one (put "Cancel" last). Returns a function that closes the dialog.
 */
export function dialog(scene: Phaser.Scene, message: string, options: DialogOption[]): () => void {
  const root = scene.add.container(0, 0).setDepth(300);
  const dim = scene.add.rectangle(0, 0, GAME_W, GAME_H, UI.ink, 0.65).setOrigin(0, 0).setInteractive();
  const w = 280;
  const text = label(scene, GAME_W / 2, 0, message, { originX: 0.5, color: UI.white });
  text.setMaxWidth(w - 24);
  text.setCenterAlign();
  const h = text.height + 52;
  const y0 = Math.round(GAME_H / 2 - h / 2);
  text.setY(y0 + 14);
  const box = panel(scene, GAME_W / 2 - w / 2, y0, w, h, UI.night, UI.yellow);
  root.add([dim, box, text]);
  const kb = scene.input.keyboard!;
  const close = () => {
    kb.off('keydown', onKey);
    root.destroy();
  };
  const pick = (o: DialogOption) => {
    close();
    o.action();
  };
  const bw = Math.min(80, Math.floor((w - 20 - (options.length - 1) * 6) / options.length));
  const bx0 = GAME_W / 2 - (options.length * bw + (options.length - 1) * 6) / 2;
  options.forEach((o, i) => {
    const b = button(scene, Math.round(bx0 + i * (bw + 6)), y0 + h - 26, bw, 16, o.label, () => {
      sfx.confirm();
      pick(o);
    });
    if (i === 0) b.setOn(true);
    root.add([b.bg, b.text]);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') pick(options[0]);
    else if (e.code === 'Escape') pick(options[options.length - 1]);
  };
  // defer so the key press that opened the dialog does not also answer it
  scene.time.delayedCall(0, () => kb.on('keydown', onKey));
  return close;
}
