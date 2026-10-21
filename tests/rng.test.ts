import { describe, expect, it } from "vitest";
import {
  fillRandom,
  makeRng,
  nextFloat,
  nextInt,
  nextUint32,
} from "../src/rng";

describe("makeRng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const first = Array.from({ length: 20 }, () => nextUint32(a));
    const second = Array.from({ length: 20 }, () => nextUint32(b));
    expect(first).toEqual(second);
  });

  it("diverges for different seeds", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const first = Array.from({ length: 20 }, () => nextUint32(a));
    const second = Array.from({ length: 20 }, () => nextUint32(b));
    expect(first).not.toEqual(second);
  });

  it("handles a zero seed", () => {
    const rng = makeRng(0);
    expect(Number.isFinite(nextUint32(rng))).toBe(true);
  });

  it("handles a large seed", () => {
    const rng = makeRng(0xffffffff);
    expect(Number.isFinite(nextUint32(rng))).toBe(true);
  });
});

describe("nextUint32", () => {
  it("stays within 32 bits", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const value = nextUint32(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("does not repeat itself immediately", () => {
    const rng = makeRng(123);
    let previous = nextUint32(rng);
    for (let i = 0; i < 100; i++) {
      const value = nextUint32(rng);
      expect(value).not.toBe(previous);
      previous = value;
    }
  });

  it("is pinned by a known answer", () => {
    // This locks the algorithm down. If the generator ever changes, every
    // sea that was ever shared by URL would silently change, so this test
    // must fail loudly instead.
    const rng = makeRng(42);
    const values = Array.from({ length: 5 }, () => nextUint32(rng));
    expect(values).toEqual([1085446021, 176895750, 789123591, 1684778745, 4229066268]);
  });
});

describe("nextFloat", () => {
  it("stays within [0, 1)", () => {
    const rng = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is roughly uniform", () => {
    const rng = makeRng(5);
    const buckets = new Array(10).fill(0);
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
      buckets[Math.floor(nextFloat(rng) * 10)]++;
    }
    for (const count of buckets) {
      expect(count / samples).toBeGreaterThan(0.07);
      expect(count / samples).toBeLessThan(0.13);
    }
  });
});

describe("nextInt", () => {
  it("stays within the bound", () => {
    const rng = makeRng(3);
    for (let i = 0; i < 500; i++) {
      const value = nextInt(rng, 7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("covers the whole range", () => {
    const rng = makeRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seen.add(nextInt(rng, 5));
    }
    expect(seen.size).toBe(5);
  });
});

describe("fillRandom", () => {
  it("fills the requested length", () => {
    const rng = makeRng(8);
    expect(fillRandom(rng, 91).length).toBe(91);
  });

  it("matches drawing one float at a time", () => {
    const a = makeRng(21);
    const b = makeRng(21);
    const filled = fillRandom(a, 10);
    const drawn = Array.from({ length: 10 }, () => nextFloat(b));
    // The array holds float32, so the values are the drawn ones rounded to
    // float32 precision.
    const expected = drawn.map((value) => Math.fround(value));
    expect(Array.from(filled)).toEqual(expected);
  });
});

describe("output quality", () => {
  it("does not concentrate its output in a narrow range", () => {
    // A 32-bit state would leave only five bits after the >> 27 and make the
    // rotation term always zero, which collapses the output onto a handful
    // of values. This catches that class of bug.
    const rng = makeRng(5);
    const values = Array.from({ length: 5000 }, () => nextUint32(rng));
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeGreaterThan(0xf0000000);
  });

  it("produces many distinct values", () => {
    const rng = makeRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 20000; i++) {
      seen.add(nextUint32(rng));
    }
    expect(seen.size).toBe(20000);
  });

  it("spreads evenly across the whole range", () => {
    const rng = makeRng(9);
    const buckets = new Array(16).fill(0);
    const samples = 32000;
    for (let i = 0; i < samples; i++) {
      buckets[Math.floor((nextUint32(rng) / 4294967296) * 16)]++;
    }
    for (const count of buckets) {
      expect(count / samples).toBeGreaterThan(0.045);
      expect(count / samples).toBeLessThan(0.075);
    }
  });
});
