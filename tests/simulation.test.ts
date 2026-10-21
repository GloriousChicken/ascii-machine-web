import { describe, expect, it } from "vitest";
import {
  advect,
  blur,
  curlFlow,
  fractalNoise,
  percentile,
  resizeField,
  rint,
  Simulation,
  valueNoise,
  VERTICAL_ASPECT,
} from "../src/simulation";
import { makeRng } from "../src/rng";

describe("rint", () => {
  it("rounds half to even, the way numpy does", () => {
    expect(rint(0.5)).toBe(0);
    expect(rint(1.5)).toBe(2);
    expect(rint(2.5)).toBe(2);
    expect(rint(3.5)).toBe(4);
  });

  it("rounds other values normally", () => {
    expect(rint(0.4)).toBe(0);
    expect(rint(0.6)).toBe(1);
    expect(rint(-0.5)).toBe(0);
    expect(rint(3.2)).toBe(3);
  });
});

describe("percentile", () => {
  it("matches numpy's linear interpolation", () => {
    const values = Float32Array.from([1, 2, 3, 4, 5]);
    expect(percentile(values, 2)).toBeCloseTo(1.08, 5);
    expect(percentile(values, 98)).toBeCloseTo(4.92, 5);
  });

  it("handles a single value", () => {
    expect(percentile(Float32Array.from([7]), 50)).toBe(7);
  });

  it("handles an empty array", () => {
    expect(percentile(new Float32Array(0), 50)).toBe(0);
  });
});

describe("valueNoise", () => {
  it("is bounded and varies", () => {
    const field = valueNoise(40, 60, 8, 4, makeRng(0));
    expect(field.length).toBe(40 * 60);
    for (const value of field) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const mean = field.reduce((a, b) => a + b, 0) / field.length;
    expect(mean).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.8);
  });

  it("is deterministic for a given seed", () => {
    const a = valueNoise(20, 20, 6, 3, makeRng(5));
    const b = valueNoise(20, 20, 6, 3, makeRng(5));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("fractalNoise", () => {
  it("stays bounded", () => {
    const field = fractalNoise(30, 30, 8, 4, makeRng(1));
    for (const value of field) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("curlFlow", () => {
  it("is normalized", () => {
    const potential = fractalNoise(40, 60, 8, 4, makeRng(0));
    const { vx, vy } = curlFlow(potential, 40, 60);
    for (let i = 0; i < vx.length; i++) {
      const magnitude = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      expect(magnitude).toBeCloseTo(1, 3);
    }
  });

  it("survives a one cell wide field", () => {
    const potential = fractalNoise(4, 1, 2, 2, makeRng(0));
    const { vx, vy } = curlFlow(potential, 4, 1);
    expect(vx.length).toBe(4);
    for (const value of vx) expect(Number.isFinite(value)).toBe(true);
    for (const value of vy) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("advect", () => {
  it("conserves total density for a uniform velocity", () => {
    const height = 30;
    const width = 50;
    const field = new Float32Array(height * width).fill(0.7);
    const vx = new Float32Array(height * width).fill(0.3);
    const vy = new Float32Array(height * width).fill(0.2);

    const result = advect(field, vx, vy, 1, height, width);
    let total = 0;
    for (const value of result) total += value;
    expect(total / (height * width)).toBeCloseTo(0.7, 4);
  });

  it("keeps a uniform field uniform", () => {
    const height = 20;
    const width = 30;
    const field = new Float32Array(height * width).fill(0.5);
    const vx = new Float32Array(height * width).fill(-0.4);
    const vy = new Float32Array(height * width).fill(0.35);

    const result = advect(field, vx, vy, 1, height, width);
    for (const value of result) {
      expect(value).toBeCloseTo(0.5, 4);
    }
  });

  it("drifts only slightly for a varying velocity", () => {
    const height = 30;
    const width = 50;
    const potential = fractalNoise(height, width, 8, 4, makeRng(2));
    const { vx, vy } = curlFlow(potential, height, width);
    const field = new Float32Array(height * width);
    const rng = makeRng(3);
    for (let i = 0; i < field.length; i++) field[i] = rng.state ? (i % 97) / 97 : 0;

    const result = advect(field, vx, vy, 1, height, width);
    let before = 0;
    let after = 0;
    for (let i = 0; i < field.length; i++) {
      before += field[i];
      after += result[i];
    }
    expect(after / before).toBeGreaterThan(0.98);
    expect(after / before).toBeLessThan(1.02);
  });
});

describe("blur", () => {
  it("keeps a uniform field uniform", () => {
    const field = new Float32Array(20 * 30).fill(0.5);
    const result = blur(field, 20, 30);
    for (const value of result) {
      expect(value).toBeCloseTo(0.5, 5);
    }
  });
});

describe("resizeField", () => {
  it("preserves the mean", () => {
    const field = new Float32Array(40 * 60);
    for (let i = 0; i < field.length; i++) field[i] = (i % 100) / 100;
    const before = field.reduce((a, b) => a + b, 0) / field.length;

    const resized = resizeField(field, 40, 60, 20, 30);
    expect(resized.length).toBe(600);
    const after = resized.reduce((a, b) => a + b, 0) / resized.length;
    expect(after).toBeCloseTo(before, 2);
  });

  it("is a no-op for the same shape", () => {
    const field = Float32Array.from([1, 2, 3, 4]);
    expect(resizeField(field, 2, 2, 2, 2)).toBe(field);
  });
});

describe("Simulation", () => {
  it("stirs density and energy at the right cell", () => {
    const sim = new Simulation(40, 60, 3);
    const before = sim.density[20 * 60 + 30];
    sim.stir(30, 20, 1, 4);
    expect(sim.density[20 * 60 + 30]).toBeGreaterThan(before);
    expect(sim.energy[20 * 60 + 30]).toBeGreaterThan(0.3);
  });

  it("falls off with distance from the stir", () => {
    const sim = new Simulation(40, 60, 3);
    sim.stir(30, 20, 1, 4);
    expect(sim.energy[20 * 60 + 30]).toBeGreaterThan(sim.energy[20 * 60 + 38]);
  });

  it("ignores a stir outside the grid", () => {
    const sim = new Simulation(40, 60, 3);
    const before = Float32Array.from(sim.density);
    sim.stir(-50, -50);
    sim.stir(500, 500);
    expect(Array.from(sim.density)).toEqual(Array.from(before));
  });

  it("decays energy toward zero", () => {
    const sim = new Simulation(40, 60, 4);
    sim.stir(30, 20, 1, 4);
    const peak = Math.max(...sim.energy);
    expect(peak).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) sim.step();
    expect(Math.max(...sim.energy)).toBeLessThan(peak * 0.2);
  });

  it("keeps the density bounded", () => {
    const sim = new Simulation(40, 60, 5);
    for (let i = 0; i < 200; i++) sim.step();
    for (const value of sim.density) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeLessThan(2);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps moving rather than freezing", () => {
    // The regression test for the frozen sea. With a static source the
    // density converges to a stationary field and the image stops changing.
    const sim = new Simulation(40, 60, 6);
    for (let i = 0; i < 150; i++) sim.step();

    const differences: number[] = [];
    for (let i = 0; i < 30; i++) {
      const before = Float32Array.from(sim.density);
      sim.step();
      let total = 0;
      for (let j = 0; j < before.length; j++) {
        total += Math.abs(sim.density[j] - before[j]);
      }
      differences.push(total / before.length);
    }

    const early = differences.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const late = differences.slice(-10).reduce((a, b) => a + b, 0) / 10;
    expect(late).toBeGreaterThan(0.002);
    expect(late).toBeGreaterThan(early * 0.25);
  });

  it("is deterministic for a given seed", () => {
    const a = new Simulation(30, 40, 123);
    const b = new Simulation(30, 40, 123);
    for (let i = 0; i < 20; i++) {
      a.step();
      b.step();
    }
    expect(Array.from(a.density)).toEqual(Array.from(b.density));
  });

  it("resets cleanly", () => {
    const sim = new Simulation(40, 60, 8);
    sim.stir(30, 20, 1, 5);
    sim.reset();
    expect(Math.max(...sim.energy)).toBe(0);
  });

  it("uses the same vertical aspect as the terminal app", () => {
    expect(VERTICAL_ASPECT).toBe(0.5);
  });
});
