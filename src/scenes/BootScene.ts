import Phaser from 'phaser';
import { buildAllTextures } from '../ui/textures.ts';
import { initMute } from '../ui/ui.ts';

/** Generates every texture from code (there are no image files), then shows the title. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    buildAllTextures(this);
    initMute();
    this.scene.start('title');
  }
}
