/**
 * Terrain generation — procedural corner-height terrain using layered value
 * noise, RollerCoaster-Tycoon-style.
 *
 * Noise is generated on the (width+1) x (height+1) *vertex* grid, quantized to
 * integer corner heights, then slope-limited so adjacent vertices differ by at
 * most 1 (every tile is flat or a unit slope). Per-tile layers are derived
 * from the corners: `elevation` = min corner, and tiles whose corners all sit
 * at or below `SEA_LEVEL` are flooded with a flat water surface.
 *
 * Runs once at city creation (cold path), not per tick.
 */

import type { CityState } from "./city-state.ts";
import {
	ELEVATION_MAX,
	MAX_GRID_SIZE,
	SEA_LEVEL,
	TERRAIN_LAND,
	TERRAIN_WATER,
} from "./constants.ts";
import { createPrng, nextFloat, type PrngState } from "./prng.ts";

// The noise grids cover vertices, not tiles: one more sample per axis.
const MAX_VERTEX_SIDE = MAX_GRID_SIZE + 1;

// Scratch array for coarse noise grids. Max coarse grid size for scale=4
// on a 257-wide vertex grid: ceil(257/4)+2 = 67 -> 67*67 = 4489.
const MAX_COARSE_SIDE = Math.ceil(MAX_VERTEX_SIDE / 4) + 2;
const coarseGrid = new Float64Array(MAX_COARSE_SIDE * MAX_COARSE_SIDE);

// Octave configuration: [scale, weight] pairs.
const OCTAVE_SCALES = [16, 8, 4] as const;
const OCTAVE_WEIGHTS = [0.5, 0.3, 0.2] as const;
const OCTAVE_COUNT = 3;

// Scratch for accumulated floating-point heights before quantization.
const accumScratch = new Float64Array(MAX_VERTEX_SIDE * MAX_VERTEX_SIDE);

/** Generate terrain (corner heights + water) for a freshly created city. */
export function generateTerrain(state: CityState, seed: number): void {
	const { width, height, vertexHeights } = state;
	const vw = width + 1;
	const vh = height + 1;
	const vertexCount = vw * vh;
	// Offset seed to avoid correlation with sim PRNG.
	const rng = createPrng(seed + 7919);

	// Accumulate noise octaves over the vertex grid
	for (let i = 0; i < vertexCount; i++) {
		accumScratch[i] = 0;
	}

	for (let o = 0; o < OCTAVE_COUNT; o++) {
		const scale = OCTAVE_SCALES[o] ?? 16;
		const weight = OCTAVE_WEIGHTS[o] ?? 0.5;
		addNoiseOctave(vw, vh, scale, weight, rng);
	}

	// Normalize to 0..1 range
	let minE = Number.MAX_VALUE;
	let maxE = -Number.MAX_VALUE;
	for (let i = 0; i < vertexCount; i++) {
		const e = accumScratch[i] ?? 0;
		if (e < minE) minE = e;
		if (e > maxE) maxE = e;
	}

	const range = maxE - minE;
	if (range < 0.001) {
		vertexHeights.fill(Math.floor(ELEVATION_MAX / 2));
		deriveTileLayers(state);
		return;
	}

	for (let i = 0; i < vertexCount; i++) {
		const normalized = ((accumScratch[i] ?? 0) - minE) / range;
		vertexHeights[i] = Math.floor(normalized * ELEVATION_MAX);
	}

	limitSlopes(vertexHeights, vw, vh);
	deriveTileLayers(state);
}

/**
 * Raise vertices until no vertex sits more than 1 below any neighbor, so every
 * tile is flat or a unit slope. Only ever raises, so it converges: a peak's
 * influence reaches at most ELEVATION_MAX rings, and a forward raster sweep
 * propagates each violation wave at least one ring per pass.
 */
function limitSlopes(heights: Uint8Array, vw: number, vh: number): void {
	for (let pass = 0; pass < ELEVATION_MAX; pass++) {
		let changed = false;
		for (let vy = 0; vy < vh; vy++) {
			for (let vx = 0; vx < vw; vx++) {
				const i = vy * vw + vx;
				let maxN = 0;
				if (vx > 0) maxN = Math.max(maxN, heights[i - 1] ?? 0);
				if (vx < vw - 1) maxN = Math.max(maxN, heights[i + 1] ?? 0);
				if (vy > 0) maxN = Math.max(maxN, heights[i - vw] ?? 0);
				if (vy < vh - 1) maxN = Math.max(maxN, heights[i + vw] ?? 0);
				if ((heights[i] ?? 0) < maxN - 1) {
					heights[i] = maxN - 1;
					changed = true;
				}
			}
		}
		if (!changed) break;
	}
}

/**
 * Derive the per-tile layers from corner heights: `elevation` = min corner
 * (the tile's base height), and tiles fully at or below sea level become
 * water with a flat surface at SEA_LEVEL.
 */
function deriveTileLayers(state: CityState): void {
	const { width, height, terrain, elevation, vertexHeights, waterLevel } =
		state;
	const vw = width + 1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const hn = vertexHeights[y * vw + x] ?? 0;
			const he = vertexHeights[y * vw + x + 1] ?? 0;
			const hs = vertexHeights[(y + 1) * vw + x + 1] ?? 0;
			const hw = vertexHeights[(y + 1) * vw + x] ?? 0;
			const minC = Math.min(hn, he, hs, hw);
			const maxC = Math.max(hn, he, hs, hw);

			const idx = y * width + x;
			elevation[idx] = minC;
			if (maxC <= SEA_LEVEL) {
				terrain[idx] = TERRAIN_WATER;
				waterLevel[idx] = SEA_LEVEL;
			} else {
				terrain[idx] = TERRAIN_LAND;
				waterLevel[idx] = 0;
			}
		}
	}
}

function addNoiseOctave(
	vw: number,
	vh: number,
	scale: number,
	weight: number,
	rng: PrngState,
): void {
	const cw = Math.ceil(vw / scale) + 2;
	const ch = Math.ceil(vh / scale) + 2;

	// Fill coarse grid with random values
	const coarseSize = cw * ch;
	for (let i = 0; i < coarseSize; i++) {
		coarseGrid[i] = nextFloat(rng);
	}

	// Bilinear interpolation to full resolution and accumulate
	for (let vy = 0; vy < vh; vy++) {
		for (let vx = 0; vx < vw; vx++) {
			const fx = vx / scale;
			const fy = vy / scale;
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

			const idx = vy * vw + vx;
			accumScratch[idx] = (accumScratch[idx] ?? 0) + val * weight;
		}
	}
}
