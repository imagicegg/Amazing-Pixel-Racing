// ============================================================================
//  TRACKS: add or reshape a circuit here.
//
//  `points` are control points of a smooth closed loop, listed in driving
//  order. The start/finish line sits on the first point, facing the second.
//  Keep different parts of the loop at least ~2 x (halfWidth + runoff + 12)
//  pixels apart so a barrier fits between them, and keep every point at
//  least ~120 px away from the edge of `size`.
//
//  The loop may cross itself, as long as one side is carried over the other
//  on a bridge (see `bridges` and `elevation`). `npm run sim` checks the
//  clearance under every bridge.
// ============================================================================

export type ThemeId = 'meadow' | 'canyon' | 'city';

/**
 * A kicker built into the road: it rises over `up` px, steepest at the lip
 * (`at`, 0..1 along the lap, `h` px high), then falls away over `down` px.
 * A car going fast enough flies off the lip.
 */
export interface Jump {
  at: number;
  h: number;
  up: number;
  down: number;
}

/** A river across the map with an optional lake where it ends; bridges carry the road over it. */
export interface River {
  /** Its course, smoothed into a curve; the ends may lie outside the map. */
  points: [number, number][];
  /** Width of the water, px. */
  width: number;
  lake?: { x: number; y: number; rx: number; ry: number };
}

export interface BoostPad {
  /** Position along the lap, 0..1. */
  at: number;
  /** Sideways offset in px, positive = right of the driving direction. */
  lateral: number;
}

/** A spot on the road: as for boost pads, `at` along the lap (0..1) and `lateral` px off the centreline. */
export type RoadSpot = BoostPad;

/** A line of gold coins along the road, 14 px apart, starting at `at`. */
export interface CoinLine extends RoadSpot {
  count: number;
}

/** A slippery patch of mud or oil (by theme), `r` px across from its middle. */
export interface PuddleSpot extends RoadSpot {
  r: number;
}

export interface TrackDef {
  id: string;
  name: string;
  blurb: string;
  difficulty: 1 | 2 | 3;
  laps: number;
  theme: ThemeId;
  /** World size in pixels. */
  size: [number, number];
  /** Half the asphalt width. */
  halfWidth: number;
  /** Grass/sand between the curb and the barrier. */
  runoff: number;
  points: [number, number][];
  boostPads: BoostPad[];
  /** Gold coins: each one a car carries adds 1% to its top speed. */
  coins: CoinLine[];
  /** Rows of three item pickups across the road (missiles and shields), at these points of the lap. */
  itemRows: number[];
  /** Things on the road that slow you when you knock them over: hay bales, kegs or traffic cones (by theme). */
  obstacles: RoadSpot[];
  puddles: PuddleSpot[];
  /**
   * Height of the road above the plain, px: [at, height] pairs in lap order
   * (at 0..1). They are joined by smooth curves that never overshoot, so two
   * equal heights in a row make a level stretch. Driving downhill speeds you up.
   */
  elevation: [number, number][];
  jumps: Jump[];
  /**
   * Stretches of road carried on a bridge deck, [from, to] along the lap
   * (0..1). Whatever is under the deck (another part of the road where the
   * loop crosses itself, or a river) passes beneath it.
   */
  bridges: [number, number][];
  river?: River;
  /** How hard the computer drivers push, 0..1. */
  aiSkill: number;
  /** Seed for scenery placement. */
  seed: number;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'meadow',
    name: 'Sunny Meadow',
    blurb: 'Rolling hills, a river and a little jump',
    difficulty: 1,
    laps: 3,
    theme: 'meadow',
    size: [2600, 1900],
    halfWidth: 36,
    runoff: 30,
    points: [
      [900, 1700], [1300, 1720], [1700, 1690], [2050, 1600], [2300, 1420], [2430, 1150], [2420, 850], [2300, 560],
      [2080, 360], [1780, 270], [1450, 290], [1100, 300], [760, 300], [480, 330], [300, 480], [330, 680],
      [550, 760], [850, 740], [1150, 720], [1450, 780], [1700, 900], [1800, 1080], [1700, 1240], [1400, 1280],
      [1100, 1260], [800, 1240], [520, 1280], [330, 1430], [380, 1640], [600, 1710],
    ],
    elevation: [
      [0, 0], [0.1, 0], [0.3, 30], [0.335, 30], [0.39, 10], [0.415, 10], [0.47, 0], [0.56, 0], [0.6, -8],
      [0.625, 3], [0.64, 9], [0.655, 3], [0.7, 0],
    ],
    jumps: [{ at: 0.84, h: 10, up: 70, down: 110 }],
    // over the river, twice
    bridges: [[0.392, 0.412], [0.632, 0.648]],
    river: {
      width: 44,
      points: [[1340, -30], [1300, 120], [1255, 300], [1215, 470], [1180, 620], [1175, 760], [1200, 900]],
      lake: { x: 1240, y: 1010, rx: 190, ry: 110 },
    },
    boostPads: [
      { at: 0.355, lateral: 0 },
      { at: 0.8, lateral: 0 },
    ],
    coins: [
      { at: 0.05, lateral: 0, count: 6 },
      { at: 0.44, lateral: -14, count: 7 },
      { at: 0.58, lateral: 12, count: 6 },
      // on the inside of the last left-hander
      { at: 0.93, lateral: -18, count: 6 },
    ],
    itemRows: [0.12, 0.47, 0.72],
    obstacles: [
      { at: 0.25, lateral: 14 },
      { at: 0.68, lateral: 12 },
      { at: 0.89, lateral: -10 },
    ],
    puddles: [
      { at: 0.22, lateral: -15, r: 14 },
      { at: 0.555, lateral: 14, r: 13 },
      { at: 0.76, lateral: -15, r: 13 },
    ],
    aiSkill: 0.84,
    seed: 11,
  },
  {
    id: 'canyon',
    name: 'Dusty Canyon',
    blurb: 'A wooden bridge, a long drop and big jumps',
    difficulty: 2,
    laps: 3,
    theme: 'canyon',
    size: [2800, 2100],
    halfWidth: 34,
    runoff: 26,
    points: [
      [1800, 1760], [2150, 1800], [2450, 1720], [2620, 1500], [2560, 1280], [2400, 1120], [2420, 900], [2580, 700],
      [2560, 450], [2350, 280], [2050, 260], [1820, 430], [1650, 700], [1400, 1000], [1150, 1300], [970, 1560],
      [700, 1780], [380, 1800], [200, 1600], [230, 1350], [450, 1250], [650, 1150], [620, 950], [420, 850],
      [230, 700], [260, 430], [500, 280], [800, 290], [1000, 480], [1180, 740], [1400, 1000], [1620, 1260],
      [1680, 1520],
    ],
    elevation: [
      [0, 0], [0.3, 0], [0.33, 4], [0.372, 30], [0.415, 30], [0.5, -20], [0.72, -20], [0.8, -14], [0.88, -8],
      [0.93, -8], [0.97, 0],
    ],
    jumps: [
      { at: 0.04, h: 8, up: 50, down: 90 },
      // off the end of the bridge, down into the canyon
      { at: 0.445, h: 14, up: 70, down: 130 },
    ],
    // a wooden trestle carries the road over itself
    bridges: [[0.37, 0.416]],
    boostPads: [
      { at: 0.08, lateral: 12 },
      { at: 0.6, lateral: 0 },
      { at: 0.76, lateral: -10 },
    ],
    coins: [
      { at: 0.13, lateral: -10, count: 6 },
      { at: 0.42, lateral: 0, count: 7 },
      { at: 0.66, lateral: 14, count: 6 },
      { at: 0.83, lateral: 0, count: 6 },
    ],
    itemRows: [0.18, 0.475, 0.79],
    obstacles: [
      { at: 0.3, lateral: 12 },
      { at: 0.47, lateral: -9 },
      { at: 0.62, lateral: -10 },
      { at: 0.95, lateral: 10 },
    ],
    puddles: [
      { at: 0.22, lateral: -14, r: 13 },
      { at: 0.69, lateral: 14, r: 13 },
      { at: 0.875, lateral: -14, r: 13 },
    ],
    aiSkill: 0.92,
    seed: 23,
  },
  {
    id: 'city',
    name: 'Neon City',
    blurb: 'Street corners, hill jumps and a flyover',
    difficulty: 3,
    laps: 3,
    theme: 'city',
    size: [2800, 2200],
    halfWidth: 31,
    runoff: 14,
    points: [
      [700, 1950], [1100, 1950], [1500, 1950], [1900, 1950], [2300, 1950], [2410, 1910], [2450, 1800], [2450, 1600],
      [2410, 1490], [2300, 1450], [1900, 1450], [1600, 1450], [1490, 1410], [1450, 1300], [1450, 1050], [1450, 700],
      [1450, 420], [1490, 330], [1600, 300], [2000, 300], [2400, 300], [2510, 340], [2550, 450], [2550, 900],
      [2510, 1010], [2400, 1050], [2000, 1050], [1450, 1050], [1000, 1050], [880, 1010], [840, 900], [840, 600],
      [800, 490], [700, 450], [460, 450], [350, 490], [310, 600], [310, 1200], [310, 1800], [350, 1910], [460, 1950],
    ],
    elevation: [
      [0, 0], [0.3, 0], [0.334, -8], [0.36, 0], [0.42, 0], [0.48, 14], [0.52, 14], [0.58, 0], [0.62, 0],
      [0.655, 28], [0.69, 28], [0.735, 0],
    ],
    // two steep city hills in a row
    jumps: [
      { at: 0.87, h: 10, up: 60, down: 100 },
      { at: 0.915, h: 10, up: 60, down: 100 },
    ],
    // the flyover: an elevated road over the avenue
    bridges: [[0.615, 0.74]],
    boostPads: [
      { at: 0.05, lateral: -12 },
      { at: 0.555, lateral: 0 },
      { at: 0.785, lateral: 10 },
    ],
    coins: [
      { at: 0.09, lateral: 10, count: 7 },
      { at: 0.27, lateral: -8, count: 6 },
      { at: 0.45, lateral: 12, count: 6 },
      { at: 0.77, lateral: -10, count: 6 },
    ],
    itemRows: [0.19, 0.5, 0.8],
    obstacles: [
      { at: 0.125, lateral: 13 },
      // a pair of cones closing the left lane
      { at: 0.38, lateral: -9 },
      { at: 0.38, lateral: -21 },
      { at: 0.58, lateral: 10 },
      { at: 0.96, lateral: -11 },
    ],
    puddles: [
      { at: 0.24, lateral: 0, r: 12 },
      { at: 0.47, lateral: 11, r: 12 },
      { at: 0.78, lateral: 11, r: 12 },
    ],
    aiSkill: 0.97,
    seed: 37,
  },
];
