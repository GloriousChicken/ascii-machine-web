/**
 * The hooks the tests use to inspect the running app.
 *
 * They are exposed on `window` so the Playwright tests can read the grid
 * and the simulation state back out of the page, which is what makes the
 * parity checks exact rather than a matter of looking at a picture.
 */

export interface Grid {
  /** The index into the ramp of the character in each cell, row-major. */
  glyphs: number[];
  /** The colour level of each cell: 0 is the sea, 1 to 3 are accents. */
  colors: number[];
  columns: number;
  rows: number;
  /** How many rows the sea occupies; the rest is the status line. */
  seaRows: number;
}

declare global {
  interface Window {
    __ready: boolean;
    __grid: () => Grid;
    __energy: () => number[];
    __density: () => number[];
    __seed: number;
    __stepsTaken: number;
    /** The width and height of one cell, in CSS pixels. */
    __cellSize: () => { cellWidth: number; cellHeight: number };
  }
}

export {};
