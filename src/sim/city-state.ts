/**
 * CityState — the complete mutable state of a city.
 *
 * All grid data is stored as flat typed arrays indexed `y * width + x`.
 * Aggregate scalars live in a single Float64Array so the entire state is
 * trivially transferable to a SharedArrayBuffer later.
 */

import {
	AGG,
	DEFAULT_HEIGHT,
	DEFAULT_TAX_RATE,
	DEFAULT_WIDTH,
	MAX_GRID_SIZE,
	STARTING_TREASURY,
	TERRAIN_LAND,
} from "./constants.ts";
import { invariant } from "./invariant.ts";
import { createPrng, type PrngState } from "./prng.ts";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CityState {
	readonly width: number;
	readonly height: number;
	readonly size: number; // width * height

	// Grid layers (length = size)
	readonly terrain: Uint8Array;
	readonly zoning: Uint8Array;
	readonly building: Uint8Array;
	readonly roads: Uint8Array;
	readonly landValue: Uint16Array;
	readonly population: Uint16Array;
	readonly jobs: Uint16Array;
	readonly pollution: Uint8Array;
	readonly traffic: Uint8Array;

	// Aggregate scalars (indexed by AGG.*)
	readonly aggregates: Float64Array;

	// Deterministic PRNG
	readonly rng: PrngState;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateCityOptions {
	width?: number;
	height?: number;
	seed?: number;
}

export function createCity(opts?: CreateCityOptions): CityState {
	const width = opts?.width ?? DEFAULT_WIDTH;
	const height = opts?.height ?? DEFAULT_HEIGHT;
	invariant(
		width > 0 && width <= MAX_GRID_SIZE,
		`width must be 1..${MAX_GRID_SIZE}`,
	);
	invariant(
		height > 0 && height <= MAX_GRID_SIZE,
		`height must be 1..${MAX_GRID_SIZE}`,
	);

	const size = width * height;

	const terrain = new Uint8Array(size);
	terrain.fill(TERRAIN_LAND);

	const state: CityState = {
		width,
		height,
		size,
		terrain,
		zoning: new Uint8Array(size),
		building: new Uint8Array(size),
		roads: new Uint8Array(size),
		landValue: new Uint16Array(size),
		population: new Uint16Array(size),
		jobs: new Uint16Array(size),
		pollution: new Uint8Array(size),
		traffic: new Uint8Array(size),
		aggregates: new Float64Array(AGG.COUNT),
		rng: createPrng(opts?.seed ?? 42),
	};

	// Defaults
	state.aggregates[AGG.TREASURY] = STARTING_TREASURY;
	state.aggregates[AGG.TAX_RATE_R] = DEFAULT_TAX_RATE;
	state.aggregates[AGG.TAX_RATE_C] = DEFAULT_TAX_RATE;
	state.aggregates[AGG.TAX_RATE_I] = DEFAULT_TAX_RATE;

	return state;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert (x, y) to flat index. No bounds check — caller must validate. */
export function tileIndex(width: number, x: number, y: number): number {
	return y * width + x;
}

/** Check if (x, y) is within grid bounds. */
export function inBounds(
	width: number,
	height: number,
	x: number,
	y: number,
): boolean {
	return x >= 0 && x < width && y >= 0 && y < height;
}
