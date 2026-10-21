/**
 * Glyph ramps and colour palettes.
 *
 * The values here are the same as the terminal app's, so a frame from the
 * browser and a frame from the terminal are the same picture. The colours
 * are given both as xterm-256 indices and as the exact RGB the terminal
 * renders for those indices, because the browser needs the RGB and the
 * indices are what the terminal app uses.
 */

/** The 24-step grayscale ramp of the xterm-256 palette. */
export const GRAY_LO = 232;
export const GRAY_HI = 255;
export const GRAY_STEPS = GRAY_HI - GRAY_LO + 1;

/**
 * The gray the sea is drawn in.
 *
 * The character already carries the brightness, so the sea itself is a
 * single gray and only the disturbed cells are coloured. That keeps the
 * number of colour changes, and so the work per frame, low.
 */
export const SEA_COLOR_INDEX = GRAY_HI;
export const SEA_COLOR: Rgb = { r: 238, g: 238, b: 238 };

/**
 * The xterm-256 grayscale ramp, as RGB.
 *
 * Index 232 is #080808 and index 255 is #eeeeee, with the steps in between
 * spaced evenly.
 */
export const GRAY_RAMP: Rgb[] = buildGrayRamp();

function buildGrayRamp(): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < GRAY_STEPS; i++) {
    const level = 8 + i * 10;
    out.push({ r: level, g: level, b: level });
  }
  return out;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Character ramps, ordered from "empty" to "full".
 *
 * All ASCII on purpose: block glyphs are not guaranteed to exist in the
 * font and would render as missing-glyph boxes.
 */
export const GLYPH_RAMPS: Record<string, string> = {
  classic: " .:-=+*#%@",
  binary: " .*#",
  sparse: " .-:=+*#%@",
  fine:
    " .'^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
};

/**
 * Accent palettes. Each holds three colours, chosen by how much energy a
 * cell holds. The values are the xterm-256 indices the terminal app uses,
 * with the RGB those indices resolve to.
 */
export const ACCENT_PALETTES: Record<string, { indices: [number, number, number]; colors: [Rgb, Rgb, Rgb] }> = {
  ember: {
    indices: [6, 13, 11],
    colors: [
      { r: 0, g: 128, b: 128 },
      { r: 255, g: 0, b: 255 },
      { r: 255, g: 255, b: 0 },
    ],
  },
  ice: {
    indices: [4, 14, 15],
    colors: [
      { r: 0, g: 0, b: 128 },
      { r: 0, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
    ],
  },
  toxic: {
    indices: [2, 11, 15],
    colors: [
      { r: 0, g: 128, b: 0 },
      { r: 255, g: 255, b: 0 },
      { r: 255, g: 255, b: 255 },
    ],
  },
  blood: {
    indices: [52, 9, 11],
    colors: [
      { r: 95, g: 0, b: 0 },
      { r: 255, g: 0, b: 0 },
      { r: 255, g: 255, b: 0 },
    ],
  },
};

/**
 * Above this much energy a cell is drawn with an accent colour rather than
 * gray.
 */
export const ACCENT_THRESHOLD = 0.3;

/** The names of the available glyph ramps, in cycle order. */
export function rampNames(): string[] {
  return Object.keys(GLYPH_RAMPS);
}

/** The names of the available accent palettes, in cycle order. */
export function paletteNames(): string[] {
  return Object.keys(ACCENT_PALETTES);
}

/**
 * Map densities in 0..1 to indices into the character ramp.
 *
 * Values outside the range are clamped rather than allowed to wrap.
 */
export function glyphIndex(density: Float32Array, ramp: string): Uint8Array {
  const glyphs = GLYPH_RAMPS[ramp];
  const count = glyphs.length;
  const out = new Uint8Array(density.length);
  for (let i = 0; i < density.length; i++) {
    const value = Math.min(1, Math.max(0, density[i]));
    out[i] = Math.round(value * (count - 1));
  }
  return out;
}

/**
 * Map energy values to 0, 1 or 2: which of the three accent colours to use.
 *
 * Zero means "not accented", so the cell is drawn in the sea's gray.
 */
export function accentIndex(energy: Float32Array): Uint8Array {
  const out = new Uint8Array(energy.length);
  const hotter = ACCENT_THRESHOLD + (1 - ACCENT_THRESHOLD) * 0.6;
  for (let i = 0; i < energy.length; i++) {
    if (energy[i] >= hotter) {
      out[i] = 2;
    } else if (energy[i] >= ACCENT_THRESHOLD) {
      out[i] = 1;
    }
  }
  return out;
}
