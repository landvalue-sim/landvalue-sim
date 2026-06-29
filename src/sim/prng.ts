/**
 * Seeded PRNG — xoshiro128** with SplitMix32 seeding.
 *
 * State is 4 × u32 stored in a Uint32Array so it can later live inside a
 * SharedArrayBuffer. All simulation randomness MUST go through this; never
 * use Math.random() or Date.now().
 */

import { invariant } from "./invariant.ts";

// ---- State ----------------------------------------------------------------

export interface PrngState {
	readonly s: Uint32Array; // length 4
}

// ---- SplitMix32 (used only to expand a single seed into 4-word state) -----

function splitmix32(state: { v: number }): number {
	state.v = (state.v + 0x9e3779b9) | 0;
	let z = state.v;
	z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
	z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
	return (z ^ (z >>> 16)) >>> 0;
}

// ---- Public API -----------------------------------------------------------

/** Seed an existing PRNG state in-place (its `s` array may alias a buffer). */
export function seedPrng(rng: PrngState, seed: number): PrngState {
	const sm = { v: seed | 0 };
	const s = rng.s;
	s[0] = splitmix32(sm);
	s[1] = splitmix32(sm);
	s[2] = splitmix32(sm);
	s[3] = splitmix32(sm);
	return rng;
}

/** Allocate a fresh PRNG state and seed it. */
export function createPrng(seed: number): PrngState {
	return seedPrng({ s: new Uint32Array(4) }, seed);
}

/** Return next u32 in [0, 2^32). Advances state. */
export function nextU32(rng: PrngState): number {
	const s = rng.s;
	const s0 = s[0];
	const s1 = s[1];
	const s2 = s[2];
	const s3 = s[3];
	invariant(
		s0 !== undefined &&
			s1 !== undefined &&
			s2 !== undefined &&
			s3 !== undefined,
		"PRNG state corrupted",
	);

	const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;

	const t = s1 << 9;

	s[2] = (s2 ?? 0) ^ (s0 ?? 0);
	s[3] = (s3 ?? 0) ^ (s1 ?? 0);
	s[1] = (s1 ?? 0) ^ (s2 ?? 0);
	s[0] = (s0 ?? 0) ^ (s3 ?? 0);
	s[2] = (s[2] ?? 0) ^ t;
	s[3] = rotl(s[3] ?? 0, 11);

	return result;
}

/** Return a float in [0, 1). */
export function nextFloat(rng: PrngState): number {
	return (nextU32(rng) >>> 0) / 0x100000000;
}

/** Return an integer in [min, max). */
export function nextInt(rng: PrngState, min: number, max: number): number {
	invariant(max > min, "nextInt: max must be greater than min");
	return min + (nextU32(rng) % (max - min));
}

// ---- Helpers --------------------------------------------------------------

function rotl(x: number, k: number): number {
	return ((x << k) | (x >>> (32 - k))) >>> 0;
}
