// The race items in the overhead view: spinning coins, item pickups,
// obstacles (which tumble away when hit), missiles in flight, and the
// shields and dizzy stars on the cars. Synced from the race every frame (see
// game/items.ts); the effects and sounds come from the race's events.
import Phaser from 'phaser';
import { OBSTACLE_RESPAWN } from '../game/items.ts';
import type { Race } from '../game/race.ts';
import { MISSILE_DIRECTIONS } from '../ui/textures.ts';

/** How long a knocked-over obstacle is seen flying off, seconds. */
const TUMBLE = 0.6;
const MISSILES = 8;

interface PickupSprites {
  glow: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
}

/** Sheet frame of the missile sprite for a heading. */
export function missileFrame(angle: number): number {
  const step = (Math.PI * 2) / MISSILE_DIRECTIONS;
  return ((Math.round((angle + Math.PI / 2) / step) % MISSILE_DIRECTIONS) + MISSILE_DIRECTIONS) % MISSILE_DIRECTIONS;
}

export class ItemSprites {
  private readonly race: Race;
  private readonly coins: { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }[] = [];
  private readonly pickups: PickupSprites[] = [];
  private readonly obstacles: { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }[] = [];
  private readonly missiles: Phaser.GameObjects.Image[] = [];
  private readonly shields: Phaser.GameObjects.Image[] = [];
  private readonly stars: Phaser.GameObjects.Image[][] = [];

  constructor(scene: Phaser.Scene, race: Race) {
    this.race = race;
    const items = race.items;
    const shadow = (key: string, depth: number) => scene.add.image(0, 0, key).setTint(0x000000).setTintMode(Phaser.TintModes.FILL).setAlpha(0.3).setDepth(depth);
    for (const c of items.coins) {
      this.coins.push({ shadow: shadow('dot', 2.55).setPosition(c.x + 1, c.y + 3), img: scene.add.image(c.x, c.y - 2, 'item-coin', 0).setDepth(2.6) });
    }
    for (const p of items.pickups) {
      const tint = p.kind === 'missile' ? 0xff6a3d : 0x41e6ff;
      const glow = scene.add.image(p.x, p.y, 'glow').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setScale(0.8).setDepth(2.6);
      const icon = scene.add.image(p.x, p.y - 3, p.kind === 'missile' ? 'item-rocket' : 'item-bubble').setDepth(2.7);
      this.pickups.push({ glow, icon, shadow: shadow('dot', 2.65).setPosition(p.x + 1, p.y + 3).setScale(2, 1) });
    }
    const key = `ob-${items.obstacleKind}`;
    for (const o of items.obstacles) {
      // upright like the scenery: stands on its bottom row
      this.obstacles.push({ shadow: shadow(key, 3.4).setOrigin(0.5, 1).setPosition(o.x + 2, o.y + 4), img: scene.add.image(o.x, o.y + 3, key).setOrigin(0.5, 1).setDepth(3.6 + o.y / 100000) });
    }
    for (let i = 0; i < MISSILES; i++) this.missiles.push(scene.add.image(0, 0, 'item-missile', 0).setDepth(6.5).setVisible(false));
    for (let i = 0; i < race.racers.length; i++) {
      this.shields.push(scene.add.image(0, 0, 'item-shield').setBlendMode(Phaser.BlendModes.ADD).setDepth(4.5).setVisible(false));
      this.stars.push([0, 1, 2].map(() => scene.add.image(0, 0, 'icon-star').setDepth(6.6).setVisible(false)));
    }
  }

  /** `clock` is the race scene's running time, for the animations. */
  update(clock: number): void {
    const items = this.race.items;
    items.coins.forEach((c, i) => {
      const s = this.coins[i];
      const on = c.respawn <= 0;
      s.img.setVisible(on);
      s.shadow.setVisible(on);
      // the coins of a line turn one after another, like a wave
      if (on) s.img.setFrame(Math.floor(clock * 8 + i * 0.7) % 4);
    });
    items.pickups.forEach((p, i) => {
      const s = this.pickups[i];
      const on = p.respawn <= 0;
      s.glow.setVisible(on).setAlpha(0.6 + 0.25 * Math.sin(clock * 5 + i));
      s.shadow.setVisible(on);
      s.icon.setVisible(on).setY(Math.round(p.y - 3 - Math.max(0, Math.sin(clock * 4 + i)) * 2));
    });
    items.obstacles.forEach((o, i) => {
      const s = this.obstacles[i];
      const since = OBSTACLE_RESPAWN - o.respawn;
      if (o.respawn <= 0) {
        s.img.setVisible(true).setPosition(o.x, o.y + 3).setRotation(0).setAlpha(1);
        s.shadow.setVisible(true);
      } else if (since < TUMBLE) {
        // knocked flying: slides off, hops and spins, fading out
        const t = since;
        const hop = Math.sin((t / TUMBLE) * Math.PI) * 8;
        s.img.setVisible(true).setPosition(o.x + o.vx * t * 0.6, o.y + 3 + o.vy * t * 0.6 - hop).setRotation(t * 14).setAlpha(1 - t / TUMBLE);
        s.shadow.setVisible(false);
      } else {
        s.img.setVisible(false);
        s.shadow.setVisible(false);
      }
    });
    this.missiles.forEach((img, i) => {
      const m = items.missiles[i];
      if (!m) {
        img.setVisible(false);
        return;
      }
      img.setVisible(true).setPosition(m.x, m.y - 4).setFrame(missileFrame(m.angle));
    });
    this.race.racers.forEach((r, i) => {
      const b = r.body;
      // the shield flickers in its last second
      const shield = r.shield > 0 && (r.shield > 1 || Math.floor(clock * 12) % 2 === 0);
      // just over its car, whether that is on a bridge or under it
      this.shields[i].setVisible(shield).setPosition(b.x, b.y).setAlpha(0.65 + 0.2 * Math.sin(clock * 9)).setDepth((r.onDeck ? 4.65 : 4.05) + b.y / 100000);
      this.stars[i].forEach((star, k) => {
        if (b.stun <= 0) {
          star.setVisible(false);
          return;
        }
        const a = clock * 5 + (k * Math.PI * 2) / 3;
        star.setVisible(true).setPosition(Math.round(b.x + Math.cos(a) * 9), Math.round(b.y - 9 + Math.sin(a) * 4));
      });
    });
  }
}
