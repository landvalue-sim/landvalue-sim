/**
 * Terrain generation — procedural terrain using layered value noise.
 *
 * Generates elevation and water bodies deterministically from a seed.
 * Runs once at city creation (cold path), not per tick.
 */

import type { CityState } from "./city-state.ts";
import {
	ELEVATION_MAX,
	MAX_GRID_SIZE,
	TERRAIN_LAND,
	TERRAIN_WATER,
	WATER_THRESHOLD,
} from "./constants.ts";
import { createPrng, nextFloat, type PrngState } from "./prng.ts";

// Scratch array for coarse noise grids. Max coarse grid size for scale=4
// on a 256-wide map: ceil(256/4)+2 = 66 -> 66*66 = 4356.
const MAX_COARSE_SIDE = Math.ceil(MAX_GRID_SIZE / 4) + 2;
const coarseGrid = new Float64Array(MAX_COARSE_SIDE * MAX_COARSE_SIDE);

// Octave configuration: [scale, weight] pairs.
const OCTAVE_SCALES = [16, 8, 4] as const;
const OCTAVE_WEIGHTS = [0.5, 0.3, 0.2] as const;
const OCTAVE_COUNT = 3;

// Scratch for accumulated floating-point elevation before quantization.
const accumScratch = new Float64Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

/** Generate terrain (elevation + water) for a freshly created city. */
export function generateTerrain(state: CityState, seed: number): void {
	const { width, height, size, terrain, elevation } = state;
	// Offset seed to avoid correlation with sim PRNG.
	const rng = createPrng(seed + 7919);

	// Accumulate noise octaves
	for (let i = 0; i < size; i++) {
		accumScratch[i] = 0;
	}

	for (let o = 0; o < OCTAVE_COUNT; o++) {
		const scale = OCTAVE_SCALES[o] ?? 16;
		const weight = OCTAVE_WEIGHTS[o] ?? 0.5;
		addNoiseOctave(width, height, scale, weight, rng);
	}

	// Normalize to 0..1 range
	let minE = Number.MAX_VALUE;
	let maxE = -Number.MAX_VALUE;
	for (let i = 0; i < size; i++) {
		const e = accumScratch[i] ?? 0;
		if (e < minE) minE = e;
		if (e > maxE) maxE = e;
	}

	const range = maxE - minE;
	if (range < 0.001) {
		elevation.fill(Math.floor(ELEVATION_MAX / 2));
		terrain.fill(TERRAIN_LAND);
		return;
	}

	const waterLevel = Math.floor(WATER_THRESHOLD * ELEVATION_MAX);

	for (let i = 0; i < size; i++) {
		const normalized = ((accumScratch[i] ?? 0) - minE) / range;
		const elev = Math.floor(normalized * ELEVATION_MAX);
		elevation[i] = elev;
		terrain[i] = elev <= waterLevel ? TERRAIN_WATER : TERRAIN_LAND;
	}
}

function addNoiseOctave(
	width: number,
	height: number,
	scale: number,
	weight: number,
	rng: PrngState,
): void {
	const cw = Math.ceil(width / scale) + 2;
	const ch = Math.ceil(height / scale) + 2;

	// Fill coarse grid with random values
	const coarseSize = cw * ch;
	for (let i = 0; i < coarseSize; i++) {
		coarseGrid[i] = nextFloat(rng);
	}

	// Bilinear interpolation to full resolution and accumulate
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const fx = x / scale;
			const fy = y / scale;
			const ix = Math.floor(fx);
			const iy = Math.floor(fy);
			const dx = fx - ix;
			const dy = fy - iy;

			const v00 = coarseGrid[iy * cw + ix] ?? 0;
			const v10 = coarseGrid[iy * cw + ix + 1] ?? 0;
			const v01 = coarseGrid[(iy + 1) * cw + ix] ?? 0;
			const v11 = coarseGrid[(iy + 1) * cw + ix + 1] ?? 0;

			const top = v00 + (v10 - v00) * dx;
			const bot = v01 + (v11 - v01) * dx;
			const val = top + (bot - top) * dy;

			const idx = y * width + x;
			accumScratch[idx] = (accumScratch[idx] ?? 0) + val * weight;
		}
	}
}
