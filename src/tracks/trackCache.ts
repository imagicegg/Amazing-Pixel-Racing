// Builds a track (geometry + painted texture) once and keeps it while the
// player stays on it, so "race again" starts instantly.
import Phaser from 'phaser';
import { buildGeometry, type TrackGeometry } from './geometry.ts';
import { paintTrack, propSprite, type Block, type DeckArt, type Lamp, type Prop } from './paint.ts';
import { buildTerrain, type Terrain } from './terrain.ts';
import { groundLevels } from './perspective.ts';
import type { TrackDef } from './tracks.ts';
import type { Raster } from '../art/raster.ts';
import { addRaster } from '../ui/textures.ts';

export interface LoadedTrack {
  geom: TrackGeometry;
  lamps: Lamp[];
  props: Prop[];
  key: string;
  /**
   * The painted ground for the chase view, which builds the blocks and the
   * scenery's shadows in 3D, so they are left out here.
   */
  raster: Raster;
  blocks: Block[];
  /** Bridge decks, painted apart from the ground (the overhead view draws them over the cars below). */
  decks: DeckArt[];
  /** Texture keys of the decks' pictures, in the same order. */
  deckKeys: string[];
  /** The lie of the land: heights for the 3D ground and the scenery. */
  terrain: Terrain;
  /** `raster` plus half, quarter and eighth size copies; made on first use. */
  levels: Raster[] | null;
}

let current: LoadedTrack | null = null;

/** Texture key of a prop sprite (created on first use). */
export function propKey(scene: Phaser.Scene, name: string): string {
  const key = `prop-${name}`;
  if (!scene.textures.exists(key)) addRaster(scene, key, propSprite(name));
  return key;
}

export function loadTrack(scene: Phaser.Scene, def: TrackDef): LoadedTrack {
  if (current && current.geom.def.id === def.id && scene.textures.exists(current.key)) return current;
  for (const key of current ? [current.key, ...current.deckKeys] : []) if (scene.textures.exists(key)) scene.textures.remove(key);
  const geom = buildGeometry(def);
  const terrain = buildTerrain(geom);
  const painted = paintTrack(geom, terrain);
  // the squared-distance field is only needed while painting
  geom.dist2 = new Float32Array(0);
  const key = `track-${def.id}`;
  addRaster(scene, key, painted.raster);
  const deckKeys = painted.decks.map((d, k) => {
    addRaster(scene, `${key}-deck${k}`, d.raster);
    return `${key}-deck${k}`;
  });
  current = { geom, lamps: painted.lamps, props: painted.props, key, raster: painted.ground, blocks: painted.blocks, decks: painted.decks, deckKeys, terrain, levels: null };
  return current;
}

/** The ground at four sizes, for drawing it near and far without shimmering. */
export function groundOf(track: LoadedTrack): Raster[] {
  track.levels ??= groundLevels(track.raster);
  return track.levels;
}
