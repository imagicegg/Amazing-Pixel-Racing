// ============================================================================
//  CAR DESIGNS: edit me!
//
//  Every car is drawn as ASCII pixel art: one character is one pixel.
//  Change a letter, save, and the game (or the /garage.html preview page)
//  reloads with your new car. Rows may have any width, but keep all rows of
//  one drawing the same length so the sprite stays rectangular.
//
//  Colour legend (shared letters come from BASE_PALETTE, the rest from the
//  car's own palette, so the same drawing can be repainted):
//
//    .  transparent        k  outline
//    B  body               b  body shadow        h  body highlight
//    a  accent / stripe    A  accent shadow      n  decal (heart, star...)
//    W  eye white          w  eye shadow         i  iris       p  pupil
//    y  headlight          Y  headlight shine    R  tail light
//    t  tyre               T  tyre tread
//    q  teeth              m  mouth              u  tongue / blush
//    z  bumper chrome      Z  chrome shine       s  dark trim (spoiler)
//    g  glass              G  glass shine
//
//  "top"   is the in-race sprite, seen from above with the nose pointing UP.
//          The game turns it into 32 rotations automatically. The pupils (p)
//          slide left/right when the car steers, so leave a little white (W)
//          on both sides of them.
//  "front" is the portrait used in menus, looking straight at you. The eyes
//          (W/w/i/p pixels) blink on their own.
//
//  Stats go from 1 to 5. Weight decides who wins a bump.
// ============================================================================

import type { Palette } from './raster.ts';

export interface CarStats {
  speed: number;
  accel: number;
  handling: number;
  weight: number;
}

export interface CarDesign {
  id: string;
  name: string;
  tagline: string;
  stats: CarStats;
  /** Colours for this car, merged over BASE_PALETTE. */
  palette: Palette;
  /** A second paint job, used when an AI rival drives a copy of this car. */
  alt: { name: string; palette: Palette };
  top: string[];
  front: string[];
}

export const BASE_PALETTE: Palette = {
  k: '#1a1c2c',
  W: '#f4f4f4',
  w: '#c2c8d6',
  p: '#1a1c2c',
  y: '#fff3a0',
  Y: '#ffffff',
  R: '#e43b44',
  t: '#333c57',
  T: '#566c86',
  g: '#5fcde4',
  G: '#c4f4ff',
  q: '#ffffff',
  m: '#5d275d',
  u: '#f47e9b',
  z: '#94b0c2',
  Z: '#e8eef4',
  s: '#29366f',
};

export const CAR_DESIGNS: CarDesign[] = [
  {
    id: 'zippy',
    name: 'Zippy',
    tagline: 'All-rounder with a sunny grin',
    stats: { speed: 4, accel: 3, handling: 4, weight: 3 },
    palette: { B: '#ffcd75', h: '#fff2c0', b: '#e89a4a', a: '#ef7d57', A: '#c25a3a', i: '#3b5dc9', n: '#f4f4f4' },
    alt: {
      name: 'Kiwi',
      palette: { B: '#a7f070', h: '#e2ffc4', b: '#38b764', a: '#257179', A: '#1a4f55', i: '#257179', n: '#f4f4f4' },
    },
    top: [
      '......kkkkkkkk......',
      '....kkhhhhhhhhkk....',
      '...khhBBaaaaBBhhk...',
      'kkkyyBBBaaaaBBByykkk',
      'TtkyyBBBaaaaBBByyktT',
      'ttkBBBBBaaaaBBBBBktt',
      'TtkbBBBBAAAABBBBbktT',
      'ttkkkkkkkkkkkkkkkktt',
      'TtkkWWWWkkkkWWWWkktT',
      'kkkWWppWWkkWWppWWkkk',
      '..kWWppWWkkWWppWWk..',
      '..kwWWWWwkkwWWWWwk..',
      '..kkwwwwkkkkwwwwkk..',
      '..kbkkkkkkkkkkkkbk..',
      '..kBhhBBaaaaBBhhBk..',
      '..kBhBBBaaaaBBBhBk..',
      'kkkbBBBBaaaaBBBBbkkk',
      'TtkbBBBBaaaaBBBBbktT',
      'ttkbBBBBaaaaBBBBbktt',
      'TtkbBBBBaaaaBBBBbktT',
      'ttkbbbbbAAAAbbbbbktt',
      'TtkBBBBBaaaaBBBBBktT',
      'kkkbBBBBAAAABBBBbkkk',
      '..kRRbbbbbbbbbbRRk..',
      '...kkkkkkkkkkkkkk...',
    ],
    front: [
      '..........kkkkkkkkkkkk..........',
      '........kkhhhhhhhhhhhhkk........',
      '.......khhBBBBaaaaBBBBhhk.......',
      '......khBBBBBBaaaaBBBBBBhk......',
      '.....khkkkkkkkkkkkkkkkkkkhk.....',
      '.....kBkkWWWWWkkkkWWWWWkkBk.....',
      '.....kBkWWiiiWWkkWWiiiWWkBk.....',
      '.....kBkWiiWpiWkkWipWiiWkBk.....',
      '..kkkkBkWipppiWkkWipppiWkBkkkk..',
      '.kBhBkBkWipppiWkkWipppiWkBkBhBk.',
      '.kBBBkBkWWiiiWWkkWWiiiWWkBkBBBk.',
      '..kkkkBkkWWWWWkkkkWWWWWkkBkkkk..',
      '.....kBBkkkkkkkkkkkkkkkkBBk.....',
      '....kBBBBBBBBBaaaaBBBBBBBBBk....',
      '...kyyyyBBBBBBaaaaBBBBBByyyyk...',
      '..kyYYyyBkkkkkkkkkkkkkkByyYYyk..',
      '..kyYyyyBkqqqqqqqqqqqqkByyyYyk..',
      '.kkyyyyBBBkmmmmmmmmmmkBBByyyykk.',
      'kttTkkBBBBBkmmuuuummkBBBBBkkTttk',
      'kTttkzzzzzzzkkkkkkkkzzzzzzzkttTk',
      'kttTkzZZzzzzzzzzzzzzzzzzZZzkTttk',
      'kTttkkkkkkkkkkkkkkkkkkkkkkkkttTk',
      'kttTk......................kTttk',
      'kTttk......................kttTk',
      'kttTk......................kTttk',
      '.kkk........................kkk.',
    ],
  },
  {
    id: 'momo',
    name: 'Momo',
    tagline: 'Tiny bubble car, quick off the line',
    stats: { speed: 3, accel: 5, handling: 4, weight: 1 },
    palette: { B: '#ff9ec8', h: '#ffd6ea', b: '#e06aa0', a: '#f4f4f4', A: '#c9d0dc', i: '#38b764', n: '#e43b6f' },
    alt: {
      name: 'Lilac',
      palette: { B: '#c3a6ff', h: '#e8dcff', b: '#8f6fd9', a: '#f4f4f4', A: '#c9d0dc', i: '#3b5dc9', n: '#5d3fd3' },
    },
    top: [
      '.......kkkkkk.......',
      '.....kkhhhhhhkk.....',
      '....khhBBBBBBhhk....',
      '...khBBBBBBBBBBhk...',
      'kkkyyBBBBBBBBBByykkk',
      'TtkyyBBBBBBBBBByyktT',
      'ttkbBBBBBBBBBBBBbktt',
      'TtkkkkkkkkkkkkkkkktT',
      'ttkkWWWWkkkkWWWWkktt',
      'kkkWWppWWkkWWppWWkkk',
      '..kWWppWWkkWWppWWk..',
      '..kwWWWWwkkwWWWWwk..',
      '..kkwwwwkkkkwwwwkk..',
      '..kbkkkkkkkkkkkkbk..',
      '..kbkaaaaaaaaaakbk..',
      '..kbkaZanaanaZakbk..',
      'kkkbkaZnnnnnnZakbkkk',
      'TtkbkaannnnnnaakbktT',
      'ttkbkaaannnnaaakbktt',
      'TtkbkAaaannaaaAkbktT',
      'ttkbBkkkkkkkkkkBbktt',
      'kkkbbbbbbbbbbbbbbkkk',
      '..kkRRbbbbbbbbRRkk..',
      '....kkkkkkkkkkkk....',
    ],
    front: [
      '...........kkkkkkkkkk...........',
      '.........kkaaaaaaaaaakk.........',
      '........kaaZZaaaaaaZZaak........',
      '.......kaaZaaaaaaaaaaZaak.......',
      '.......kaaaaaaaaaaaaaaaak.......',
      '......kkAAAAAAAAAAAAAAAAkk......',
      '.....kkkkkkkkkkkkkkkkkkkkkk.....',
      '.....kBkkWWWWWkkkkWWWWWkkBk.....',
      '.....kBkWWiiiWWkkWWiiiWWkBk.....',
      '..kk.kBkWiWWpiWkkWipWWiWkBk.kk..',
      '.kBBkkBkWiWppiWkkWippWiWkBkkBBk.',
      '.kBhBkBkWipppiWkkWipppiWkBkBhBk.',
      '.kBBkkBkWWiiiWWkkWWiiiWWkBkkBBk.',
      '..kk.kBkkWWWWWkkkkWWWWWkkBk.kk..',
      '.....kBBkkkkkkkkkkkkkkkkBBk.....',
      '....kBBuuBBBBBBBBBBBBBBuuBBk....',
      '...kBBBuuBBBkkkkkkkkBBBuuBBBk...',
      '...kyyBBBBBBkmmmmmmkBBBBBByyk...',
      '..kyYyyBBBBBBkmuumkBBBBBByyYyk..',
      '..kyyyyBBBBBBBkkkkBBBBBBByyyyk..',
      '..kkyykBBBBBBBBBBBBBBBBBBkyykk..',
      '.kttkkzzzzzzzzzzzzzzzzzzzzkkttk.',
      '.kTtkzZZzzzzzzzzzzzzzzzzZZzktTk.',
      '.kttkkkkkkkkkkkkkkkkkkkkkkkkttk.',
      '.kTtk......................ktTk.',
      '..kk........................kk..',
    ],
  },
  {
    id: 'rumble',
    name: 'Rumble',
    tagline: 'Heavy muscle car, unbeatable top speed',
    stats: { speed: 5, accel: 2, handling: 3, weight: 5 },
    palette: { B: '#3b6fd9', h: '#7fb2ff', b: '#27408f', a: '#ef7d57', A: '#ffcd75', i: '#9a5a32', n: '#f4f4f4' },
    alt: {
      name: 'Ruby',
      palette: { B: '#d64545', h: '#ff8a7a', b: '#8f2a3a', a: '#ffcd75', A: '#fff3a0', i: '#5d275d', n: '#f4f4f4' },
    },
    top: [
      '......kkkkkkkkkk......',
      '....kkhhhhhhhhhhkk....',
      '...khhBBBBBBBBBBhhk...',
      '.kkkyyBBBBaaBBBByykkk.',
      '.TtkyyBBBaAAaBBByyktT.',
      '.ttkBBBBaAAAAaBBBBktt.',
      '.TtkBBBaAaBBaAaBBBktT.',
      '.ttkBBaAaBBBBaAaBBktt.',
      '.TtkBBaaBBBBBBaaBBktT.',
      '.kkkBaBBBBBBBBBBaBkkk.',
      '...kbBBBBBBBBBBBBbk...',
      '...kkkkkkkkkkkkkkkk...',
      '...kkbbbbkkkkbbbbkk...',
      '...kWWppWWkkWWppWWk...',
      '...kWWppWWkkWWppWWk...',
      '...kkwwwwkkkkwwwwkk...',
      '...kbkkkkkkkkkkkkbk...',
      '...kBhhBBBBBBBBhhBk...',
      '...kBhBBBBBBBBBBhBk...',
      'kkkkbBBBBBBBBBBBBbkkkk',
      'TttkbBBBBBBBBBBBBbkttT',
      'tTtkbBBBBBBBBBBBBbktTt',
      'TttkbBBBBBBBBBBBBbkttT',
      'tTtkbbbbbbbbbbbbbbktTt',
      'TttkBBBBBBBBBBBBBBkttT',
      'kkkkbBBBBBBBBBBBBbkkkk',
      'kkkkkkkkkkkkkkkkkkkkkk',
      'kssssssssssssssssssssk',
      'kRRssssssssssssssssRRk',
      'kkkkkkkkkkkkkkkkkkkkkk',
    ],
    front: [
      '...kkkkkkkkkkkkkkkkkkkkkkkkkkkk...',
      '...kssssssssssssssssssssssssssk...',
      '...kkkkkkkkkkkkkkkkkkkkkkkkkkkk...',
      '.........kkkhhhhhhhhhhkkk.........',
      '........khhhBBBBBBBBBBhhhk........',
      '.......khBBBBBBBBBBBBBBBBhk.......',
      '......khkkkkkkkkkkkkkkkkkkhk......',
      '......kBkbbbbbbbkkbbbbbbbkBk......',
      '......kBkWWbbbbbkkbbbbbWWkBk......',
      '......kBkWiiWbbbkkbbbWiiWkBk......',
      '...kkkkBkWipppibkkbipppiWkBkkkk...',
      '..kBhBkBkWipppiWkkWipppiWkBkBhBk..',
      '..kBBBkBkWWiiiWWkkWWiiiWWkBkBBBk..',
      '...kkkkBkkWWWWWkkkkWWWWWkkBkkkk...',
      '......kBBkkkkkkkkkkkkkkkkBBk......',
      '.....kBBBBBBBBaBBBBaBBBBBBBBk.....',
      '....kyyyyBBBBaAaBBaAaBBBByyyyk....',
      '...kyYYyyBkkkkkkkkkkkkkkByyYYyk...',
      '...kyYyyyBkqqqqqqqqqqqqkByyyYyk...',
      '..kkyyyyBBkmmmmmmmmmmmmkBByyyykk..',
      '.kttTkkBBBkqqqqqqqqqqqqkBBBkkTttk.',
      '.kTttkzzzzzkkkkkkkkkkkkzzzzzkttTk.',
      '.kttTkzZZzzzzzzzzzzzzzzzzZZzkTttk.',
      '.kTttkkkkkkkkkkkkkkkkkkkkkkkkttTk.',
      '.kttTk......................kTttk.',
      '.kTttk......................kttTk.',
      '.kttTk......................kTttk.',
      '..kkk........................kkk..',
    ],
  },
];
