/**
 * The flow-field simulation behind the sea.
 *
 * This is a port of the Python implementation in the ascii-machine terminal
 * app, structured to mirror it so the two can be diffed mentally. It uses
 * its own random generator, so the same seed gives a different (but equally
 * deterministic) sea than the terminal app.
 *
 * The central idea is a divergence-free flow field derived from the curl of
 * a fractal noise potential. Material, the density, is carried along that
 * field by semi-Lagrangian advection, and fresh material is fed in from a
 * noise source.
 *
 * The source and the potential are *panned* through oversized noise tiles
 * with toroidal wraparound. A static source makes the density converge to a
 * stationary field and the sea visibly freezes, so panning is what keeps it
 * alive. There is a regression test for exactly that.
 */

import { fillRandom, makeRng, type Rng } from "./rng";

/**
 * Terminal cells are about twice as tall as they are wide, so a square-pixel
 * field looks vertically stretched. This scales the vertical half of the
 * simulation to compensate. It matches the terminal app's value, so the two
 * produce the same shape of flow.
 */
export const VERTICAL_ASPECT = 0.5;

/** How far the source and potential drift, in cells per simulation step. */
export const SOURCE_PAN: readonly [number, number] = [1, 2];
export const POTENTIAL_PAN: readonly [number, number] = [0, 1];

/**
 * The grid the simulation always runs on.
 *
 * A fixed size means a seed means the same sea whatever the window is. The
 * density is resampled to the display size for rendering. Without this, the
 * same seed at two different window sizes gives two completely different
 * seas, because the noise grids are sized in absolute cells.
 */
export const CANONICAL_WIDTH = 160;
export const CANONICAL_HEIGHT = 60;

/** Extra room in the noise tiles so the pan can wrap around them. */
export const TILE_PAD = 64;

/**
 * Round half to even, the way numpy's `rint` does.
 *
 * `Math.round` rounds half up, which is a different function and would map
 * some densities to a different character than the terminal app does.
 */
export function rint(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // Exactly a half: round to the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * A percentile, matching numpy's linear interpolation between sorted
 * samples.
 *
 * The simulation uses the 2nd and 98th percentiles to normalize the field
 * before rendering, so this has to agree with numpy closely enough that the
 * same density maps to the same character.
 */
export function percentile(values: Float32Array, q: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const position = (q / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Bilinear value noise with smoothstep interpolation, in 0..1.
 *
 * Fully vectorized, like the Python version: the cost is a handful of typed
 * array passes regardless of the field size.
 */
export function valueNoise(
  height: number,
  width: number,
  cellsX: number,
  cellsY: number,
  rng: Rng,
): Float32Array {
  const cx = Math.max(1, Math.floor(cellsX));
  const cy = Math.max(1, Math.floor(cellsY));

  const grid = fillRandom(rng, (cy + 1) * (cx + 1));
  const out = new Float32Array(height * width);

  for (let y = 0; y < height; y++) {
    const fyRaw = (y * cy) / height;
    const y0 = Math.floor(fyRaw);
    const fy = fyRaw - y0;
    const smoothY = fy * fy * (3 - 2 * fy);
    const rowA = y0 * (cx + 1);
    const rowB = (y0 + 1) * (cx + 1);

    for (let x = 0; x < width; x++) {
      const fxRaw = (x * cx) / width;
      const x0 = Math.floor(fxRaw);
      const fx = fxRaw - x0;
      const smoothX = fx * fx * (3 - 2 * fx);

      const a = grid[rowA + x0];
      const b = grid[rowA + x0 + 1];
      const c = grid[rowB + x0];
      const d = grid[rowB + x0 + 1];

      const top = a + (b - a) * smoothX;
      const bottom = c + (d - c) * smoothX;
      out[y * width + x] = top + (bottom - top) * smoothY;
    }
  }

  return out;
}

/** Sum a few octaves of value noise, each finer and weaker than the last. */
export function fractalNoise(
  height: number,
  width: number,
  cellsX: number,
  cellsY: number,
  rng: Rng,
  octaves = 2,
): Float32Array {
  const out = new Float32Array(height * width);
  let amplitude = 1;
  let norm = 0;

  for (let octave = 0; octave < octaves; octave++) {
    const scale = 2 ** octave;
    const layer = valueNoise(
      height,
      width,
      Math.max(2, Math.floor(cellsX * scale)),
      Math.max(2, Math.floor(cellsY * scale)),
      rng,
    );
    for (let i = 0; i < out.length; i++) {
      out[i] += layer[i] * amplitude;
    }
    norm += amplitude;
    amplitude *= 0.5;
  }

  for (let i = 0; i < out.length; i++) {
    out[i] /= norm;
  }
  return out;
}

/**
 * Turn a scalar potential into a normalized, divergence-free velocity field.
 *
 * The gradient is taken with central differences in the interior and one
 * sided differences at the edges, which is what numpy's `gradient` does.
 */
export function curlFlow(potential: Float32Array, height: number, width: number) {
  const vx = new Float32Array(height * width);
  const vy = new Float32Array(height * width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      // d/dx
      let dx: number;
      if (width >= 2) {
        if (x === 0) {
          dx = potential[index + 1] - potential[index];
        } else if (x === width - 1) {
          dx = potential[index] - potential[index - 1];
        } else {
          dx = (potential[index + 1] - potential[index - 1]) / 2;
        }
      } else {
        dx = 0;
      }

      // d/dy
      let dy: number;
      if (height >= 2) {
        if (y === 0) {
          dy = potential[index + width] - potential[index];
        } else if (y === height - 1) {
          dy = potential[index] - potential[index - width];
        } else {
          dy = (potential[index + width] - potential[index - width]) / 2;
        }
      } else {
        dy = 0;
      }

      vx[index] = -dy;
      vy[index] = dx;
    }
  }

  for (let i = 0; i < vx.length; i++) {
    // The guard has to be relative to the magnitude. A fixed epsilon is
    // negligible for a strong gradient but becomes a large relative error
    // where the gradient is near zero, which leaves the vector slightly
    // short and the field not quite divergence free.
    const magnitude = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
    const scale = magnitude > 1e-12 ? 1 / magnitude : 0;
    vx[i] *= scale;
    vy[i] *= scale;
  }

  return { vx, vy };
}

/**
 * Carry a field along the velocity field, sampling from upstream.
 *
 * The grid wraps toroidally, so material leaving one edge reappears on the
 * other and no mass is created or destroyed.
 */
export function advect(
  field: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  speed: number,
  height: number,
  width: number,
): Float32Array {
  const out = new Float32Array(field.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const sampleY = y - vy[index] * speed * VERTICAL_ASPECT;
      const sampleX = x - vx[index] * speed;

      const y0Raw = Math.floor(sampleY);
      const x0Raw = Math.floor(sampleX);
      const fy = sampleY - y0Raw;
      const fx = sampleX - x0Raw;

      const y0 = ((y0Raw % height) + height) % height;
      const x0 = ((x0Raw % width) + width) % width;
      const y1 = (y0 + 1) % height;
      const x1 = (x0 + 1) % width;

      const a = field[y0 * width + x0];
      const b = field[y0 * width + x1];
      const c = field[y1 * width + x0];
      const d = field[y1 * width + x1];

      const top = a + (b - a) * fx;
      const bottom = c + (d - c) * fx;
      out[index] = top + (bottom - top) * fy;
    }
  }

  return out;
}

/** A gentle 5-point blur, used to diffuse the velocity field. */
export function blur(field: Float32Array, height: number, width: number): Float32Array {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    const up = ((y - 1 + height) % height) * width;
    const down = ((y + 1) % height) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = (x - 1 + width) % width;
      const right = (x + 1) % width;
      out[row + x] =
        (field[up + x] +
          field[down + x] +
          field[row + left] +
          field[row + right] +
          4 * field[row + x]) /
        8;
    }
  }
  return out;
}

/**
 * Resample a field to a new shape, preserving its overall structure.
 *
 * Used to show a canonical simulation on a differently sized display.
 */
export function resizeField(
  field: Float32Array,
  fromHeight: number,
  fromWidth: number,
  toHeight: number,
  toWidth: number,
): Float32Array {
  if (fromHeight === toHeight && fromWidth === toWidth) return field;
  const out = new Float32Array(toHeight * toWidth);

  for (let y = 0; y < toHeight; y++) {
    const rowPos = (y * (fromHeight - 1)) / Math.max(1, toHeight - 1);
    const r0 = Math.floor(rowPos);
    const r1 = Math.min(r0 + 1, fromHeight - 1);
    const fr = rowPos - r0;

    for (let x = 0; x < toWidth; x++) {
      const colPos = (x * (fromWidth - 1)) / Math.max(1, toWidth - 1);
      const c0 = Math.floor(colPos);
      const c1 = Math.min(c0 + 1, fromWidth - 1);
      const fc = colPos - c0;

      const top = field[r0 * fromWidth + c0] * (1 - fc) + field[r0 * fromWidth + c1] * fc;
      const bottom =
        field[r1 * fromWidth + c0] * (1 - fc) + field[r1 * fromWidth + c1] * fc;
      out[y * toWidth + x] = top * (1 - fr) + bottom * fr;
    }
  }

  return out;
}

/** The state of the sea: density, energy, and the flow that carries them. */
export class Simulation {
  readonly height: number;
  readonly width: number;

  /** How much material is suspended at each cell. This is what gets drawn. */
  density: Float32Array;
  /** A decaying record of recent stirring. This selects the accent colour. */
  energy: Float32Array;
  vx: Float32Array;
  vy: Float32Array;

  speed = 1;
  decay = 0.985;
  injection = 0.01;
  energyDecay = 0.94;

  private rng: Rng;
  private sourceTile: Float32Array;
  private potentialTile: Float32Array;
  private sourceOffset: [number, number] = [0, 0];
  private potentialOffset: [number, number] = [0, 0];

  constructor(height: number, width: number, seed: number) {
    this.height = Math.max(1, Math.floor(height));
    this.width = Math.max(1, Math.floor(width));
    this.rng = makeRng(seed);

    this.density = new Float32Array(this.height * this.width);
    this.energy = new Float32Array(this.height * this.width);
    this.vx = new Float32Array(this.height * this.width);
    this.vy = new Float32Array(this.height * this.width);

    this.sourceTile = new Float32Array(0);
    this.potentialTile = new Float32Array(0);
    this.buildTiles();
    this.reset();
  }

  /**
   * Generate the oversized noise tiles that get panned through.
   *
   * The order matters and matches the Python version: the potential tile is
   * drawn first, then the source tile.
   */
  private buildTiles(): void {
    const tileHeight = this.height + TILE_PAD;
    const tileWidth = this.width + TILE_PAD;

    // The potential's noise grid is coarser vertically to compensate for
    // terminal cells being about twice as tall as they are wide.
    this.potentialTile = fractalNoise(tileHeight, tileWidth, 12, 6, this.rng, 2);
    this.sourceTile = fractalNoise(tileHeight, tileWidth, 9, 5, this.rng, 2);
  }

  /** Start the sea again: fresh flow, fresh density, no interaction marks. */
  reset(): void {
    this.sourceOffset = [0, 0];
    this.potentialOffset = [0, 0];
    this.updateFlow();
    this.density = Float32Array.from(this.sourceView());
    this.energy = new Float32Array(this.height * this.width);
  }

  /**
   * The source field at the current pan offset, wrapped toroidally.
   */
  private sourceView(): Float32Array {
    return this.pannedView(this.sourceTile, this.sourceOffset);
  }

  private potentialView(): Float32Array {
    return this.pannedView(this.potentialTile, this.potentialOffset);
  }

  private pannedView(
    tile: Float32Array,
    offset: [number, number],
  ): Float32Array {
    const tileHeight = this.height + TILE_PAD;
    const tileWidth = this.width + TILE_PAD;
    const out = new Float32Array(this.height * this.width);

    for (let y = 0; y < this.height; y++) {
      const sourceRow = ((y + offset[0]) % tileHeight + tileHeight) % tileHeight;
      for (let x = 0; x < this.width; x++) {
        const sourceCol = ((x + offset[1]) % tileWidth + tileWidth) % tileWidth;
        out[y * this.width + x] = tile[sourceRow * tileWidth + sourceCol];
      }
    }
    return out;
  }

  private updateFlow(): void {
    const { vx, vy } = curlFlow(
      this.potentialView(),
      this.height,
      this.width,
    );
    this.vx = vx;
    this.vy = vy;
  }

  /** Advance the simulation by one step. */
  step(): void {
    this.sourceOffset[0] += SOURCE_PAN[0];
    this.sourceOffset[1] += SOURCE_PAN[1];
    this.potentialOffset[0] += POTENTIAL_PAN[0];
    this.potentialOffset[1] += POTENTIAL_PAN[1];
    this.updateFlow();

    this.density = advect(
      this.density,
      this.vx,
      this.vy,
      this.speed,
      this.height,
      this.width,
    );

    const source = this.sourceView();
    for (let i = 0; i < this.density.length; i++) {
      this.density[i] = this.density[i] * this.decay + source[i] * this.injection;
    }

    this.energy = advect(
      this.energy,
      this.vx,
      this.vy,
      this.speed,
      this.height,
      this.width,
    );
    for (let i = 0; i < this.energy.length; i++) {
      this.energy[i] *= this.energyDecay;
    }

    this.vx = blur(this.vx, this.height, this.width);
    this.vy = blur(this.vy, this.height, this.width);
  }

  /**
   * Push material and flow around a point, and mark it as interacted with.
   *
   * The energy mark is what turns the touched cells into accent colours, so
   * it fades over a second or two rather than lasting forever.
   */
  stir(x: number, y: number, strength = 1, radius = 4): void {
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(this.width, Math.floor(x + radius) + 1);
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(this.height, Math.floor(y + radius) + 1);
    if (x0 >= x1 || y0 >= y1) return;

    const radiusSquared = radius * radius;
    for (let row = y0; row < y1; row++) {
      for (let col = x0; col < x1; col++) {
        const dx = col - x;
        const dy = row - y;
        const falloff = Math.exp(-(dx * dx + dy * dy) / radiusSquared);
        const index = row * this.width + col;

        this.vx[index] += falloff * strength * 0.35;
        this.vy[index] += falloff * strength * 0.35;
        this.density[index] += falloff * strength * 0.25;
        if (this.density[index] > 1.5) this.density[index] = 1.5;
        if (falloff > this.energy[index]) this.energy[index] = falloff;
      }
    }
  }
}
