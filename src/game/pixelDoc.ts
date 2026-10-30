// An editable ASCII pixel drawing (one character per pixel) with undo/redo,
// mirrored painting and flood fill. Used by the paint shop. Pure TypeScript.

export class PixelDoc {
  readonly w: number;
  readonly h: number;
  private cells: string[];
  private undoStack: string[][] = [];
  private redoStack: string[][] = [];
  private pending: string[] | null = null;

  constructor(rows: readonly string[]) {
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    this.cells = rows.flatMap((r) => r.padEnd(this.w, '.').split(''));
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): string {
    return this.inside(x, y) ? this.cells[y * this.w + x] : '.';
  }

  private set(x: number, y: number, ch: string): void {
    if (this.inside(x, y)) this.cells[y * this.w + x] = ch;
  }

  /** Starts an undoable edit (a whole brush stroke, a fill...). */
  begin(): void {
    if (!this.pending) this.pending = this.cells.slice();
  }

  /** Finishes the edit; it only enters the history if something changed. Returns whether it did. */
  end(): boolean {
    const before = this.pending;
    this.pending = null;
    if (!before || before.every((c, i) => c === this.cells[i])) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  /** Paints one pixel, and its mirror image across the vertical centre line. */
  paint(x: number, y: number, ch: string, mirror: boolean): void {
    this.set(x, y, ch);
    if (mirror) this.set(this.w - 1 - x, y, ch);
  }

  /** Paints a gap-free line, so fast mouse moves still leave a solid stroke. */
  line(x0: number, y0: number, x1: number, y1: number, ch: string, mirror: boolean): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.paint(x0, y0, ch, mirror);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Flood-fills the 4-connected area of the clicked colour. */
  fill(x: number, y: number, ch: string, mirror: boolean): void {
    this.flood(x, y, ch);
    if (mirror) this.flood(this.w - 1 - x, y, ch);
  }

  private flood(x: number, y: number, ch: string): void {
    const target = this.get(x, y);
    if (!this.inside(x, y) || target === ch) return;
    const stack = [x, y];
    while (stack.length) {
      const cy = stack.pop()!;
      const cx = stack.pop()!;
      if (this.get(cx, cy) !== target || !this.inside(cx, cy)) continue;
      this.set(cx, cy, ch);
      stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.cells);
    this.cells = prev;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.cells);
    this.cells = next;
    return true;
  }

  /** Number of painted (non-transparent) pixels. */
  painted(): number {
    return this.cells.reduce((n, c) => n + (c === '.' ? 0 : 1), 0);
  }

  rows(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.cells.slice(y * this.w, (y + 1) * this.w).join(''));
    return out;
  }
}
