import { describe, expect, it } from "vitest";
import {
  ACCENT_PALETTES,
  ACCENT_THRESHOLD,
  accentIndex,
  GRAY_RAMP,
  GRAY_STEPS,
  GLYPH_RAMPS,
  glyphIndex,
  paletteNames,
  rampNames,
  SEA_COLOR,
} from "../src/palette";

describe("glyph ramps", () => {
  it("are all ASCII", () => {
    for (const [name, ramp] of Object.entries(GLYPH_RAMPS)) {
      expect(/^[\x20-\x7e]+$/.test(ramp), `ramp ${name} contains non-ASCII characters`).toBe(
        true,
      );
    }
  });

  it("have no repeated characters", () => {
    for (const [name, ramp] of Object.entries(GLYPH_RAMPS)) {
      expect(new Set(ramp).size, `ramp ${name} repeats a character`).toBe(
        ramp.length,
      );
    }
  });

  it("are at least two characters long", () => {
    for (const [name, ramp] of Object.entries(GLYPH_RAMPS)) {
      expect(ramp.length, `ramp ${name} is too short`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("glyphIndex", () => {
  it("maps the endpoints to the ends of the ramp", () => {
    const ramp = "classic";
    const count = GLYPH_RAMPS[ramp].length;
    const result = glyphIndex(Float32Array.from([0, 1]), ramp);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(count - 1);
  });

  it("clamps values outside the range", () => {
    const ramp = "classic";
    const count = GLYPH_RAMPS[ramp].length;
    const result = glyphIndex(Float32Array.from([-5, 5]), ramp);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(count - 1);
  });

  it("spreads values across the whole ramp", () => {
    const ramp = "classic";
    const count = GLYPH_RAMPS[ramp].length;
    const density = Float32Array.from({ length: 100 }, (_, i) => i / 99);
    const result = glyphIndex(density, ramp);
    const seen = new Set(result);
    expect(seen.size).toBe(count);
  });
});

describe("accentIndex", () => {
  it("leaves quiet cells unaccented", () => {
    expect(accentIndex(Float32Array.from([0]))[0]).toBe(0);
    expect(accentIndex(Float32Array.from([ACCENT_THRESHOLD - 0.01]))[0]).toBe(0);
  });

  it("marks disturbed cells", () => {
    expect(accentIndex(Float32Array.from([ACCENT_THRESHOLD + 0.01]))[0]).toBe(1);
    expect(accentIndex(Float32Array.from([1]))[0]).toBe(2);
  });

  it("is monotonic in energy", () => {
    const energy = Float32Array.from([0, 0.1, 0.35, 0.5, 0.7, 0.9, 1]);
    const result = accentIndex(energy);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
  });
});

describe("colours", () => {
  it("has a 24-step grayscale ramp", () => {
    expect(GRAY_STEPS).toBe(24);
    expect(GRAY_RAMP.length).toBe(24);
  });

  it("matches the xterm-256 grayscale endpoints", () => {
    expect(GRAY_RAMP[0]).toEqual({ r: 8, g: 8, b: 8 });
    expect(GRAY_RAMP[GRAY_RAMP.length - 1]).toEqual({ r: 238, g: 238, b: 238 });
  });

  it("uses the same sea colour the terminal app renders", () => {
    expect(SEA_COLOR).toEqual({ r: 238, g: 238, b: 238 });
  });

  it("gives every palette three valid colours", () => {
    for (const [name, palette] of Object.entries(ACCENT_PALETTES)) {
      expect(palette.indices.length, `palette ${name}`).toBe(3);
      expect(palette.colors.length, `palette ${name}`).toBe(3);
      for (const index of palette.indices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(255);
      }
      for (const color of palette.colors) {
        for (const channel of [color.r, color.g, color.b]) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("matches the terminal app's accent colours", () => {
    // The exact values the terminal app renders, so the two look the same.
    expect(ACCENT_PALETTES.ember.colors).toEqual([
      { r: 0, g: 128, b: 128 },
      { r: 255, g: 0, b: 255 },
      { r: 255, g: 255, b: 0 },
    ]);
    expect(ACCENT_PALETTES.ice.colors[0]).toEqual({ r: 0, g: 0, b: 128 });
    expect(ACCENT_PALETTES.blood.colors[0]).toEqual({ r: 95, g: 0, b: 0 });
  });
});

describe("names", () => {
  it("are stable and in order", () => {
    expect(rampNames()).toEqual(Object.keys(GLYPH_RAMPS));
    expect(paletteNames()).toEqual(Object.keys(ACCENT_PALETTES));
  });
});
