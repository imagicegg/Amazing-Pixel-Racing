// Every sound in the game is synthesised with WebAudio: no audio files.
// Includes a tiny chiptune sequencer for the menu and race music.

type Wave = OscillatorType;

/** One voice of a song. */
interface Part {
  /** Space separated steps: note names, '~' to hold, '-' for rest. */
  notes: string;
  wave: Wave;
  vol: number;
  /** Short, plucked notes (guitar, arpeggio) instead of held ones. */
  pluck?: boolean;
  /** Vibrato on held notes, in cents. */
  vibrato?: number;
  /** Low-pass filter cutoff in Hz (softens sawtooth and square waves). */
  filter?: number;
  /** How much of this voice goes to the echo (0..1). */
  echo?: number;
}

interface Song {
  bpm: number;
  /** Steps per beat: 2 for 8th notes (default), 4 for 16th notes. */
  div?: number;
  parts: Part[];
  /**
   * One char per step: K kick, S snare, h closed hat, o open hat, c clap,
   * X kick + clap, t tom, w whip crack, . nothing.
   */
  drums: string;
  /** Echo delay, in beats. */
  echoBeats?: number;
}

const bars = (...rows: string[]) => rows.join(' ');

/** Sunny Meadow: bright and bouncy. */
const MEADOW_SONG: Song = {
  bpm: 152,
  parts: [
    {
      wave: 'square',
      vol: 0.07,
      notes: bars(
        'C6 ~ G5 E5 ~ G5 C6 D6',
        'E6 ~ D6 C6 ~ A5 ~ ~',
        'F5 A5 C6 ~ A5 F5 A5 C6',
        'D6 ~ B5 G5 ~ ~ - -',
        'C6 ~ G5 E5 ~ G5 C6 E6',
        'G6 ~ E6 C6 ~ A5 C6 E6',
        'F6 ~ E6 D6 C6 ~ A5 C6',
        'B5 ~ D6 ~ G6 ~ ~ -',
      ),
    },
    {
      wave: 'triangle',
      vol: 0.16,
      notes: bars(
        'C3 C4 C3 C4 C3 C4 C3 C4',
        'A2 A3 A2 A3 A2 A3 A2 A3',
        'F2 F3 F2 F3 F2 F3 F2 F3',
        'G2 G3 G2 G3 G2 G3 B2 B3',
        'C3 C4 C3 C4 C3 C4 C3 C4',
        'A2 A3 A2 A3 A2 A3 A2 A3',
        'F2 F3 F2 F3 F2 F3 F2 F3',
        'G2 G3 G2 G3 D3 D4 G2 G3',
      ),
    },
  ],
  drums: 'KhShKhSh'.repeat(7) + 'KhShKSSS',
};

// The canyon and city songs step in 16th notes: one bar is 16 steps.
/** A bar of the canyon's galloping bass (root and fifth, "da, da-da"). */
const gallop = (root: string, fifth: string) => `${root} - ${root} ${root} ${fifth} - ${fifth} ${fifth} `.repeat(2).trim();
/** A bar of plucked off-beat chord tones, like a strummed guitar. */
const picks = (a: string, b: string) => `- - ${a} - - - ${b} - - - ${a} - - - ${b} -`;
/** A bar of the city's driving bass: root, root, octave, root on every beat. */
const drive = (lo: string, hi: string) => `${lo} ${lo} ${hi} ${lo} `.repeat(4).trim();
/** A bar of rising arpeggio through a chord, four times over. */
const arp = (chord: string) => `${chord} `.repeat(4).trim();

/** Dusty Canyon: a dusty western gallop in A minor, with a Spanish E major. */
const CANYON_SONG: Song = {
  bpm: 132,
  div: 4,
  parts: [
    {
      // a whistled tune: soft square with a slow vibrato on the long notes
      wave: 'square',
      vol: 0.09,
      vibrato: 22,
      filter: 2600,
      notes: bars(
        'E5 ~ ~ ~ A5 ~ B5 ~ C6 ~ ~ ~ ~ ~ ~ ~',
        'B5 ~ A5 ~ G5 ~ A5 ~ E5 ~ ~ ~ ~ ~ - -',
        'D5 ~ ~ ~ G5 ~ A5 ~ B5 ~ ~ ~ ~ ~ A5 ~',
        'A5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - - - -',
        'C6 ~ ~ ~ A5 ~ F5 ~ A5 ~ C6 ~ F6 ~ ~ ~',
        'E6 ~ ~ ~ D6 ~ B5 ~ G5 ~ ~ ~ B5 ~ D6 ~',
        'C6 ~ B5 ~ A5 ~ ~ ~ E5 ~ ~ ~ A5 ~ C6 ~',
        'B5 ~ ~ ~ G#5 ~ ~ ~ E5 ~ ~ ~ - - - -',
        'D6 ~ D6 ~ F6 ~ E6 ~ D6 ~ ~ ~ A5 ~ ~ ~',
        'C6 ~ C6 ~ E6 ~ D6 ~ C6 ~ ~ ~ A5 ~ ~ ~',
        'F6 ~ E6 ~ D6 ~ F6 ~ A6 ~ ~ ~ G6 ~ F6 ~',
        'E6 ~ ~ ~ ~ ~ ~ ~ G#5 ~ B5 ~ E6 ~ ~ ~',
        'E5 ~ ~ ~ A5 ~ B5 ~ C6 ~ ~ ~ E6 ~ ~ ~',
        'D6 ~ ~ ~ B5 ~ G5 ~ D6 ~ ~ ~ B5 ~ ~ ~',
        'C6 ~ A5 ~ F5 ~ A5 ~ C6 ~ B5 ~ A5 ~ G#5 ~',
        'B5 ~ ~ ~ ~ ~ ~ ~ - - - - G#5 ~ B5 ~',
      ),
    },
    {
      wave: 'square',
      vol: 0.045,
      pluck: true,
      filter: 1800,
      notes: bars(
        picks('C5', 'E5'),
        picks('C5', 'E5'),
        picks('B4', 'D5'),
        picks('C5', 'E5'),
        picks('A4', 'C5'),
        picks('B4', 'D5'),
        picks('C5', 'E5'),
        picks('G#4', 'B4'),
        picks('F4', 'A4'),
        picks('C5', 'E5'),
        picks('F4', 'A4'),
        picks('G#4', 'B4'),
        picks('C5', 'E5'),
        picks('B4', 'D5'),
        picks('A4', 'C5'),
        picks('G#4', 'B4'),
      ),
    },
    {
      wave: 'triangle',
      vol: 0.3,
      pluck: true,
      notes: bars(
        gallop('A2', 'E2'),
        gallop('A2', 'E2'),
        gallop('G2', 'D2'),
        gallop('A2', 'E2'),
        gallop('F2', 'C3'),
        gallop('G2', 'D2'),
        gallop('A2', 'E2'),
        gallop('E2', 'B2'),
        gallop('D2', 'A2'),
        gallop('A2', 'E2'),
        gallop('D2', 'A2'),
        gallop('E2', 'B2'),
        gallop('A2', 'E2'),
        gallop('G2', 'D2'),
        gallop('F2', 'C3'),
        gallop('E2', 'B2'),
      ),
    },
  ],
  // galloping hats; every fourth bar ends on a snare pickup and a whip crack
  drums: ('K.hhS.hhK.hhS.hh'.repeat(3) + 'K.hhS.hhK.hhSSw.').repeat(4),
};

/** Neon City: night-time synthwave in E minor. */
const CITY_SONG: Song = {
  bpm: 120,
  div: 4,
  echoBeats: 0.75,
  parts: [
    {
      // a soft sawtooth lead with a dotted-8th echo
      wave: 'sawtooth',
      vol: 0.095,
      vibrato: 10,
      filter: 2200,
      echo: 0.45,
      notes: bars(
        'B5 ~ ~ ~ ~ ~ ~ ~ G5 ~ ~ ~ A5 ~ B5 ~',
        'C6 ~ ~ ~ ~ ~ ~ ~ B5 ~ ~ ~ G5 ~ ~ ~',
        'D6 ~ ~ ~ ~ ~ B5 ~ ~ ~ ~ ~ G5 ~ A5 ~',
        'F#5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - - - -',
        'E6 ~ ~ ~ D6 ~ ~ ~ B5 ~ ~ ~ G5 ~ ~ ~',
        'G5 ~ ~ ~ A5 ~ ~ ~ B5 ~ ~ ~ C6 ~ ~ ~',
        'D6 ~ ~ ~ E6 ~ ~ ~ D6 ~ ~ ~ B5 ~ ~ ~',
        'A5 ~ ~ ~ ~ ~ ~ ~ F#5 ~ ~ ~ A5 ~ ~ ~',
        'C6 ~ ~ ~ ~ ~ ~ ~ B5 ~ ~ ~ A5 ~ ~ ~',
        'G5 ~ ~ ~ ~ ~ ~ ~ E5 ~ ~ ~ G5 ~ ~ ~',
        'B5 ~ ~ ~ ~ ~ ~ ~ E6 ~ ~ ~ G6 ~ ~ ~',
        'F#6 ~ ~ ~ ~ ~ ~ ~ D#6 ~ ~ ~ B5 ~ ~ ~',
        'E6 ~ ~ ~ G6 ~ ~ ~ F#6 ~ ~ ~ E6 ~ ~ ~',
        'D6 ~ ~ ~ E6 ~ ~ ~ C6 ~ ~ ~ ~ ~ ~ ~',
        'D6 ~ ~ ~ ~ ~ C6 ~ B5 ~ ~ ~ A5 ~ ~ ~',
        'B5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - - - -',
      ),
    },
    {
      // sparkling arpeggios
      wave: 'square',
      vol: 0.042,
      pluck: true,
      filter: 3200,
      echo: 0.3,
      notes: bars(
        arp('E5 G5 B5 E6'),
        arp('C5 E5 G5 C6'),
        arp('G4 B4 D5 G5'),
        arp('D5 F#5 A5 D6'),
        arp('E5 G5 B5 E6'),
        arp('C5 E5 G5 C6'),
        arp('G4 B4 D5 G5'),
        arp('D5 F#5 A5 D6'),
        arp('A4 C5 E5 A5'),
        arp('C5 E5 G5 C6'),
        arp('E5 G5 B5 E6'),
        arp('B4 D#5 F#5 B5'),
        arp('E5 G5 B5 E6'),
        arp('C5 E5 G5 C6'),
        arp('D5 F#5 A5 D6'),
        arp('B4 D#5 F#5 B5'),
      ),
    },
    {
      // a filtered sawtooth bass driving 16ths
      wave: 'sawtooth',
      vol: 0.19,
      pluck: true,
      filter: 700,
      notes: bars(
        drive('E2', 'E3'),
        drive('C2', 'C3'),
        drive('G2', 'G3'),
        drive('D2', 'D3'),
        drive('E2', 'E3'),
        drive('C2', 'C3'),
        drive('G2', 'G3'),
        drive('D2', 'D3'),
        drive('A2', 'A3'),
        drive('C2', 'C3'),
        drive('E2', 'E3'),
        drive('B1', 'B2'),
        drive('E2', 'E3'),
        drive('C2', 'C3'),
        drive('D2', 'D3'),
        drive('B1', 'B2'),
      ),
    },
  ],
  // four on the floor, claps on 2 and 4, an open hat on the off-beats; a fill every fourth bar
  drums: ('K.h.X.o.K.h.X.o.'.repeat(3) + 'K.h.X.o.K.t.XtXX').repeat(4),
};

const MENU_SONG: Song = {
  bpm: 116,
  parts: [
    {
      wave: 'triangle',
      vol: 0.12,
      notes: bars(
        'E5 ~ ~ G5 ~ ~ C6 ~',
        'B5 ~ A5 ~ E5 ~ ~ ~',
        'F5 ~ ~ A5 ~ ~ C6 ~',
        'D6 ~ C6 ~ B5 ~ G5 ~',
        'E5 ~ ~ G5 ~ ~ C6 ~',
        'E6 ~ D6 ~ C6 ~ A5 ~',
        'F5 ~ A5 ~ C6 ~ D6 ~',
        'C6 ~ ~ ~ - - - -',
      ),
    },
    {
      wave: 'triangle',
      vol: 0.16,
      notes: bars(
        'C3 ~ ~ ~ G2 ~ ~ ~',
        'A2 ~ ~ ~ E2 ~ ~ ~',
        'F2 ~ ~ ~ C3 ~ ~ ~',
        'G2 ~ ~ ~ D3 ~ ~ ~',
        'C3 ~ ~ ~ G2 ~ ~ ~',
        'A2 ~ ~ ~ E2 ~ ~ ~',
        'F2 ~ ~ ~ G2 ~ ~ ~',
        'C3 ~ ~ ~ C2 ~ ~ ~',
      ),
    },
  ],
  drums: 'K...h...K.h.h...'.repeat(4),
};

/** Songs by name: the menus, and one per track theme. */
const SONGS = { menu: MENU_SONG, meadow: MEADOW_SONG, canyon: CANYON_SONG, city: CITY_SONG };
export type SongName = keyof typeof SONGS;

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteFreq(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 0;
  let n = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  n += (parseInt(m[3], 10) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}

class Synth {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private muted = false;
  private engine: { a: OscillatorNode; b: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private skid: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private rumble: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private song: Song | null = null;
  /** The song's parts, already split into steps. */
  private tracks: string[][] = [];
  private songName: SongName | '' = '';
  private step = 0;
  /** A shared feedback echo for the parts that ask for it. */
  private echoIn: GainNode | null = null;
  private echoDelay: DelayNode | null = null;
  private nextTime = 0;
  private timer: number | undefined;
  private lastBlip = 0;

  /** Must be called from a user gesture before anything can be heard. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      // echo: delay -> darker repeats -> back into the delay, and out to the music
      this.echoIn = ctx.createGain();
      this.echoDelay = ctx.createDelay(2);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2400;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.33;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      this.echoIn.connect(this.echoDelay);
      this.echoDelay.connect(tone);
      tone.connect(feedback).connect(this.echoDelay);
      tone.connect(wet).connect(this.musicBus);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      if (this.songName) this.startSong(this.songName);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }

  private tone(freq: number, dur: number, wave: Wave = 'square', vol = 0.15, slideTo = 0, delay = 0, bus?: GainNode): void {
    const ctx = this.ctx;
    if (!ctx || !freq) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0, bus?: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // --- menu sounds -------------------------------------------------------
  blip(): void {
    const now = performance.now();
    if (now - this.lastBlip < 40) return;
    this.lastBlip = now;
    this.tone(990, 0.06, 'square', 0.08);
  }
  confirm(): void {
    this.tone(660, 0.08, 'square', 0.1);
    this.tone(990, 0.14, 'square', 0.1, 0, 0.07);
  }
  back(): void {
    this.tone(520, 0.08, 'square', 0.08);
    this.tone(350, 0.12, 'square', 0.08, 0, 0.07);
  }

  // --- race sounds -------------------------------------------------------
  countdown(go: boolean): void {
    if (go) this.tone(880, 0.5, 'square', 0.14);
    else this.tone(440, 0.18, 'square', 0.12);
  }
  lap(final: boolean): void {
    const notes = final ? [784, 988, 1175, 1568] : [784, 1047, 1319];
    notes.forEach((f, i) => this.tone(f, 0.16, 'square', 0.09, 0, i * 0.08));
  }
  finish(place: number): void {
    const win = [523, 659, 784, 1047, 784, 1047, 1319];
    const meh = [523, 494, 523, 659, 523];
    (place <= 1 ? win : meh).forEach((f, i) => this.tone(f, i === win.length - 1 ? 0.6 : 0.16, 'square', 0.1, 0, i * 0.11));
  }
  bump(power: number): void {
    const v = Math.min(0.35, 0.08 + power / 600);
    this.noise(0.12, v, 500);
    this.tone(140, 0.12, 'sine', v, 60);
  }
  wall(power: number): void {
    const v = Math.min(0.35, 0.06 + power / 700);
    this.noise(0.16, v, 900, 'bandpass');
    this.tone(110, 0.16, 'triangle', v * 0.8, 45);
  }
  boost(): void {
    this.tone(220, 0.45, 'sawtooth', 0.07, 880);
    this.noise(0.4, 0.08, 2400, 'highpass');
  }
  /** Tyres biting as the tail kicks out; a rising blip when it extends a combo. */
  driftStart(combo: number): void {
    this.noise(0.22, 0.07, 1900, 'bandpass');
    if (combo > 1) this.tone(520 + combo * 130, 0.08, 'square', 0.06);
  }
  /** A combo banked: a quick arpeggio, longer for bigger scores. */
  driftBank(points: number): void {
    const notes = points >= 20000 ? [784, 988, 1175, 1568] : points >= 8000 ? [784, 988, 1319] : [880, 1175];
    notes.forEach((f, i) => this.tone(f, 0.1, 'square', 0.06, 0, i * 0.06));
  }
  driftCrash(): void {
    this.tone(330, 0.3, 'sawtooth', 0.06, 110);
  }
  nitroReady(): void {
    this.tone(1047, 0.1, 'square', 0.07);
    this.tone(1568, 0.18, 'square', 0.07, 0, 0.1);
  }
  /** The nitro lighting up: a rising roar and a rush of air. */
  nitro(): void {
    this.tone(110, 0.7, 'sawtooth', 0.09, 660);
    this.noise(1.1, 0.1, 1800, 'highpass');
  }
  /** Coming down from a jump: a soft thump, heavier the harder the landing. */
  land(impact: number): void {
    const v = Math.min(0.3, 0.08 + impact / 900);
    this.noise(0.14, v, 380);
    this.tone(120, 0.16, 'sine', v, 55);
  }
  /** Back on the track after a reset: a soft puff and a little "boing" up. */
  reset(): void {
    this.noise(0.18, 0.08, 1200, 'bandpass');
    this.tone(330, 0.16, 'triangle', 0.1, 990);
    this.tone(1319, 0.08, 'square', 0.05, 0, 0.12);
  }

  // --- items ---------------------------------------------------------------
  /** A coin collected: a bright two-note "ding", a little higher for every coin you carry. */
  coin(count: number): void {
    const f = 988 * Math.pow(2, Math.min(count, 10) / 24);
    this.tone(f, 0.05, 'square', 0.06);
    this.tone(f * 1.5, 0.12, 'square', 0.06, 0, 0.05);
  }
  /** An item picked up: a quick rising chime (lower for a missile, higher for a shield). */
  pickup(missile: boolean): void {
    const notes = missile ? [523, 659, 784] : [784, 988, 1319];
    notes.forEach((f, i) => this.tone(f, 0.08, 'triangle', 0.09, 0, i * 0.05));
  }
  /** A missile leaving its launcher: a hiss and a falling whoosh. */
  launch(): void {
    this.noise(0.5, 0.09, 2600, 'highpass');
    this.tone(880, 0.4, 'sawtooth', 0.05, 220);
  }
  /** Warning beep while a missile is coming for you. */
  warn(): void {
    this.tone(1568, 0.06, 'square', 0.06);
  }
  /** A missile hitting: a crack of noise and a deep thump. */
  boom(): void {
    this.noise(0.5, 0.3, 700);
    this.tone(90, 0.45, 'sine', 0.3, 35);
  }
  /** A shield going up: a shimmering run of notes. */
  shieldUp(): void {
    [659, 880, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.07, 0, i * 0.04));
  }
  /** A missile bursting on a shield: a glassy "ping". */
  shieldBlock(): void {
    this.tone(2093, 0.25, 'triangle', 0.1, 1568);
    this.noise(0.2, 0.08, 3000, 'highpass');
  }
  /** Knocking over an obstacle: a dull thud. */
  knock(): void {
    this.noise(0.12, 0.16, 400);
    this.tone(160, 0.12, 'square', 0.08, 70);
  }
  /** Driving into a puddle: a short wet splash. */
  splash(): void {
    this.noise(0.25, 0.12, 900, 'bandpass');
  }
  /** Trying to fire a missile with no car ahead: a low "bonk". */
  noTarget(): void {
    this.tone(220, 0.12, 'square', 0.07, 165);
  }

  // --- continuous engine / tyre noise ------------------------------------
  startEngine(): void {
    const ctx = this.ctx;
    if (!ctx || this.engine) return;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain).connect(this.sfxBus);
    a.start();
    b.start();
    this.engine = { a, b, gain, filter };
    const loop = (freq: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start();
      return { gain: g, src };
    };
    this.skid = loop(1500, 'bandpass');
    this.rumble = loop(260, 'lowpass');
  }

  /** speed: 0..1 of top speed. */
  updateEngine(speed: number, throttle: number, skid: number, offroad: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const t = ctx.currentTime;
    const f = 48 + speed * 150 + Math.max(0, throttle) * 14;
    this.engine.a.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.b.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(380 + speed * 1300 + Math.max(0, throttle) * 300, t, 0.06);
    this.engine.gain.gain.setTargetAtTime(0.035 + Math.max(0, throttle) * 0.03 + speed * 0.02, t, 0.06);
    this.skid?.gain.gain.setTargetAtTime(Math.min(0.09, skid * 0.09), t, 0.04);
    this.rumble?.gain.gain.setTargetAtTime(offroad ? 0.12 * Math.min(1, speed * 2) : 0, t, 0.05);
  }

  stopEngine(): void {
    if (!this.engine) return;
    const { a, b, gain } = this.engine;
    const t = this.ctx!.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.05);
    a.stop(t + 0.3);
    b.stop(t + 0.3);
    for (const n of [this.skid, this.rumble]) {
      if (!n) continue;
      n.gain.gain.setTargetAtTime(0, t, 0.05);
      n.src.stop(t + 0.3);
    }
    this.engine = null;
    this.skid = null;
    this.rumble = null;
  }

  // --- music -------------------------------------------------------------
  music(name: SongName | null): void {
    if (name === this.songName && (this.timer !== undefined || !this.ctx)) return;
    this.songName = name ?? '';
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.song = null;
    if (name && this.ctx) this.startSong(name);
  }

  private startSong(name: SongName): void {
    const ctx = this.ctx!;
    const song = SONGS[name];
    this.song = song;
    this.tracks = song.parts.map((p) => p.notes.split(' '));
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    if (this.echoDelay) this.echoDelay.delayTime.setValueAtTime(((song.echoBeats ?? 0.75) * 60) / song.bpm, ctx.currentTime);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song) return;
    const len = Math.max(song.drums.length, ...this.tracks.map((t) => t.length));
    const stepDur = 60 / song.bpm / (song.div ?? 2);
    while (this.nextTime < ctx.currentTime + 0.15) {
      const i = this.step % len;
      const t = this.nextTime;
      song.parts.forEach((part, k) => this.voice(part, this.tracks[k], i, t, stepDur));
      const d = song.drums[i % song.drums.length];
      if (d === 'K' || d === 'X') this.drum(t, 'kick');
      if (d === 'S') this.drum(t, 'snare');
      if (d === 'c' || d === 'X') this.drum(t, 'clap');
      if (d === 'h') this.drum(t, 'hat');
      if (d === 'o') this.drum(t, 'open');
      if (d === 't') this.drum(t, 'tom');
      if (d === 'w') this.drum(t, 'whip');
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private voice(part: Part, seq: string[], i: number, t: number, stepDur: number): void {
    const n = seq[i % seq.length];
    if (!n || n === '~' || n === '-') return;
    let hold = 1;
    while (seq[(i + hold) % seq.length] === '~' && hold < seq.length) hold++;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = part.wave;
    const freq = noteFreq(n);
    o.frequency.value = freq;
    const g = ctx.createGain();
    const vol = part.vol;
    const dur = hold * stepDur * 0.92;
    g.gain.setValueAtTime(0.0001, t);
    if (part.pluck) {
      // a quick pluck that dies away
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, 0.22));
    } else {
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.setTargetAtTime(vol * 0.6, t + 0.03, 0.08);
      g.gain.setTargetAtTime(0.0001, t + dur - 0.02, 0.02);
    }
    let out: AudioNode = o;
    if (part.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = part.filter;
      f.Q.value = 1.2;
      out = out.connect(f);
    }
    out.connect(g).connect(this.musicBus);
    if (part.echo && this.echoIn) {
      const send = ctx.createGain();
      send.gain.value = part.echo;
      g.connect(send).connect(this.echoIn);
    }
    // vibrato on the longer notes, easing in after the attack
    if (part.vibrato && dur > 0.3) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(freq * (Math.pow(2, part.vibrato / 1200) - 1), t + 0.25);
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private drum(t: number, kind: 'kick' | 'snare' | 'hat' | 'open' | 'clap' | 'tom' | 'whip'): void {
    const ctx = this.ctx!;
    if (kind === 'kick' || kind === 'tom') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(kind === 'kick' ? 150 : 220, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'kick' ? 45 : 90, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(kind === 'kick' ? 0.35 : 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.16);
      return;
    }
    if (kind === 'whip') {
      // a quick bright crack with a falling chirp
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(2400, t);
      o.frequency.exponentialRampToValueAtTime(500, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.1);
    }
    const noise = (start: number, len: number, vol: number, type: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(start, Math.random() * 0.5);
      src.stop(start + len + 0.02);
    };
    if (kind === 'snare') noise(t, 0.12, 0.22, 'bandpass', 1800);
    else if (kind === 'hat') noise(t, 0.04, 0.06, 'highpass', 7000);
    else if (kind === 'open') noise(t, 0.16, 0.05, 'highpass', 6500);
    else if (kind === 'whip') noise(t, 0.09, 0.12, 'highpass', 3000);
    else {
      // a clap: three quick bursts and a short tail
      for (const k of [0, 0.011, 0.022]) noise(t + k, 0.02, 0.14, 'bandpass', 1300);
      noise(t + 0.03, 0.13, 0.12, 'bandpass', 1300);
    }
  }
}

export const sfx = new Synth();
