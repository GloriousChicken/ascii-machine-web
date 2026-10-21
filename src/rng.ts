/**
 * A small, well-specified seeded pseudo-random generator.
 *
 * The web version deliberately does NOT use numpy's PCG64, so it does not
 * produce the same sea as the terminal app for a given seed. What matters
 * instead is that it is deterministic and documented, so a seed always means
 * the same sea, and so a future refactor cannot silently change every sea
 * that was ever shared.
 *
 * The algorithm is PCG-XSH-RR, as published by O'Neill:
 *
 *   state      = state * 6364136223846793005 + increment
 *   xorshifted = ((state >> 18) ^ state) >> 27
 *   rot        = state >> 59
 *   result     = rotr32(xorshifted, rot)
 *
 * The state is 64 bits and the output 32 bits. That combination is the
 * important detail: a 32-bit state leaves only five bits after the `>> 27`,
 * and the `>> 59` rotation term is always zero, which makes the output badly
 * biased. A 64-bit state keeps the rotation meaningful and the output
 * uniform.
 *
 * The multiply is done with BigInt because 64x64 bit multiplication overflows
 * the 53 bits of precision a JS number has.
 */

/** The PCG multiplier. */
const MULTIPLIER = 6364136223846793005n;

const MASK_32 = 0xffffffffn;
const MASK_64 = 0xffffffffffffffffn;

/** A generator's mutable state. */
export interface Rng {
  state: bigint;
  increment: bigint;
}

/**
 * Build a generator from a seed.
 *
 * The same seed always gives the same sequence.
 */
export function makeRng(seed: number): Rng {
  const s = BigInt(seed >>> 0);
  // The increment must be odd.
  const increment = ((s << 1n) | 1n) & MASK_32;
  const rng: Rng = { state: 0n, increment };

  // Mix the seed in, then advance a couple of times so that nearby seeds do
  // not produce similar streams.
  rng.state = (rng.state * MULTIPLIER + rng.increment) & MASK_64;
  rng.state = (rng.state + s) & MASK_64;
  rng.state = (rng.state * MULTIPLIER + rng.increment) & MASK_64;

  return rng;
}

/** Draw the next 32-bit unsigned integer. */
export function nextUint32(rng: Rng): number {
  const old = rng.state;
  rng.state = (old * MULTIPLIER + rng.increment) & MASK_64;

  const xorshifted = (((old >> 18n) ^ old) >> 27n) & MASK_32;
  const rot = (old >> 59n) & 31n;

  // A rotate of 0 would shift by 32, which wraps the other way round, so it
  // is handled explicitly.
  if (rot === 0n) {
    return Number(xorshifted);
  }
  return Number(
    ((xorshifted >> rot) | (xorshifted << ((32n - rot) & 31n))) & MASK_32,
  );
}

/** Draw a float in [0, 1). */
export function nextFloat(rng: Rng): number {
  return nextUint32(rng) / 4294967296;
}

/** Draw an integer in [0, bound). */
export function nextInt(rng: Rng, bound: number): number {
  return Math.floor(nextFloat(rng) * bound);
}

/**
 * Fill an array with floats in [0, 1), row-major.
 *
 * This is the shape the noise function needs: a grid of random values that
 * it interpolates between.
 */
export function fillRandom(rng: Rng, length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = nextFloat(rng);
  }
  return out;
}
