// Garage page: renders every design in src/art/cars.ts, plus the cars saved
// from the in-game paint shop in this browser, without starting the game.
import { BASE_PALETTE, CAR_DESIGNS, type CarDesign } from './art/cars.ts';
import { customCars, designToCode, isCustom } from './game/customCars.ts';
import { CAR_DIRECTIONS, buildCarSheet, buildPortrait, carPalette, type CarSheet } from './art/sprites.ts';
import type { Raster } from './art/raster.ts';
import { rasterToCanvas } from './ui/canvas.ts';

function scaled(r: Raster, scale: number): HTMLCanvasElement {
  const c = rasterToCanvas(r);
  c.style.width = `${r.w * scale}px`;
  c.style.height = `${r.h * scale}px`;
  return c;
}

function figure(caption: string, el: HTMLElement): HTMLElement {
  const f = document.createElement('figure');
  f.append(el);
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  f.append(cap);
  return f;
}

/** Cycles through the rotation frames like a turntable. */
function spinner(sheet: CarSheet, scale: number): HTMLCanvasElement {
  const src = rasterToCanvas(sheet.raster);
  const c = document.createElement('canvas');
  c.width = sheet.frame;
  c.height = sheet.frame;
  c.style.width = `${sheet.frame * scale}px`;
  c.style.height = `${sheet.frame * scale}px`;
  const ctx = c.getContext('2d')!;
  let dir = 0;
  let tick = 0;
  setInterval(() => {
    tick++;
    dir = (dir + 1) % CAR_DIRECTIONS;
    // every full turn the eyes switch: ahead, left, right
    const look = Math.floor(tick / CAR_DIRECTIONS) % 3;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, dir * sheet.frame, look * sheet.frame, sheet.frame, sheet.frame, 0, 0, sheet.frame, sheet.frame);
  }, 90);
  return c;
}

function checkRows(name: string, rows: string[]): string | null {
  const w = rows[0]?.length ?? 0;
  const bad = rows.findIndex((r) => r.length !== w);
  return bad >= 0 ? `${name}: row ${bad + 1} is ${rows[bad].length} pixels wide, the first row is ${w}.` : null;
}

function card(d: CarDesign): HTMLElement {
  const el = document.createElement('section');
  el.className = 'car';
  const title = document.createElement('h2');
  title.textContent = `${d.name} `;
  const id = document.createElement('small');
  id.textContent = isCustom(d.id) ? '(paint shop)' : `(${d.id})`;
  title.append(id);
  const tag = document.createElement('p');
  tag.className = 'tag';
  tag.textContent = d.tagline;
  el.append(title, tag);
  try {
    const problems = [checkRows('top', d.top), checkRows('front', d.front)].filter(Boolean);
    if (problems.length) throw new Error(problems.join('\n'));
    for (const alt of isCustom(d.id) ? [false] : [false, true]) {
      const face = buildPortrait(d, alt);
      const sheet = buildCarSheet(d, alt);
      const row = document.createElement('div');
      row.className = 'row';
      const s = alt ? 2 : 4;
      row.append(
        figure(alt ? `${d.alt.name} (rival paint)` : 'portrait', scaled(face.open, s)),
        figure('blink', scaled(face.blink, s)),
        figure('top view', scaled(sheet.plain, alt ? 2 : 5)),
        figure('in race', spinner(sheet, alt ? 2 : 4)),
      );
      el.append(row);
    }
    const stats = document.createElement('div');
    stats.className = 'stats';
    stats.innerHTML = Object.entries(d.stats)
      .map(([k, v]) => `<div><span>${k}</span>${'&#9632;'.repeat(v)}${'&#9633;'.repeat(5 - v)}</div>`)
      .join('');
    el.append(stats);
    const sw = document.createElement('div');
    sw.className = 'swatches';
    const pal = carPalette(d);
    const used = new Set([...d.top.join(''), ...d.front.join('')]);
    sw.innerHTML = Object.entries(pal)
      .filter(([k]) => used.has(k))
      .map(([k, v]) => `<div><i style="background:${v}"></i>${k}${k in BASE_PALETTE && !(k in d.palette) ? '' : '*'}</div>`)
      .join('');
    el.append(sw);
    if (isCustom(d.id)) el.append(copyButton(d));
  } catch (err) {
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = String(err instanceof Error ? err.message : err);
    el.append(box);
  }
  return el;
}

/** Copies the car as a CAR_DESIGNS entry, ready to paste into src/art/cars.ts. */
function copyButton(d: CarDesign): HTMLElement {
  const b = document.createElement('button');
  b.className = 'copy';
  b.type = 'button';
  b.textContent = 'Copy code for cars.ts';
  const wrap = document.createElement('div');
  b.addEventListener('click', () => {
    const code = designToCode(d);
    const showText = () => {
      // clipboard refused (unfocused or embedded page): let the reader copy by hand
      let box = wrap.querySelector('textarea');
      if (!box) {
        box = document.createElement('textarea');
        box.readOnly = true;
        box.rows = 8;
        box.className = 'code';
        wrap.append(box);
      }
      box.value = code;
      box.select();
      b.textContent = 'Copy blocked: select the code below and copy it';
    };
    try {
      navigator.clipboard.writeText(code).then(() => (b.textContent = 'Copied! Paste it into CAR_DESIGNS'), showText);
    } catch {
      showText();
    }
  });
  wrap.append(b);
  return wrap;
}

function section(heading: string, note: string, cars: CarDesign[]): void {
  const h = document.createElement('h3');
  h.textContent = heading;
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = note;
  const grid = document.createElement('div');
  grid.className = 'cars';
  for (const d of cars) grid.append(card(d));
  document.getElementById('garage')!.append(h, p, grid);
}

section('Team cars', 'Built in, from src/art/cars.ts.', CAR_DESIGNS);
const mine = customCars();
section(
  'Your paint shop cars',
  mine.length
    ? 'Saved in this browser by the in-game paint shop. Copy one into src/art/cars.ts to make it a permanent team car.'
    : 'None yet. In the game, open Choose your racer and pick the New car card at the end of the row.',
  mine,
);
