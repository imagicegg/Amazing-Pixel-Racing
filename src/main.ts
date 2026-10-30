import Phaser from 'phaser';
import { GAME_H, GAME_W } from './config.ts';
import { BootScene } from './scenes/BootScene.ts';
import { TitleScene } from './scenes/TitleScene.ts';
import { CarSelectScene } from './scenes/CarSelectScene.ts';
import { TrackSelectScene } from './scenes/TrackSelectScene.ts';
import { RaceScene } from './scenes/RaceScene.ts';
import { ResultsScene } from './scenes/ResultsScene.ts';
import { PaintShopScene } from './scenes/PaintShopScene.ts';

// Some embeds (iframes on game portals) block the Gamepad API; asking for it would throw.
function gamepadAllowed(): boolean {
  try {
    navigator.getGamepads?.();
    return typeof navigator.getGamepads === 'function';
  } catch {
    return false;
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#1a1c2c',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { gamepad: gamepadAllowed() },
  // all sound is synthesised in src/game/audio.ts
  audio: { noAudio: true },
  scene: [BootScene, TitleScene, CarSelectScene, TrackSelectScene, RaceScene, ResultsScene, PaintShopScene],
});

// handy for debugging from the browser console during development
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
