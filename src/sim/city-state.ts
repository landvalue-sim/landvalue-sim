/**
 * CityState — the complete mutable state of a city.
 *
 * All grid data, aggregate scalars, and the PRNG state are stored as typed
 * arrays that are *views into a single backing buffer*. That buffer can be a
 * plain `ArrayBuffer` (headless tests, single-thread) or a `SharedArrayBuffer`
 * (the sim worker writes it, the render shell reads it zero-copy). The byte
 * layout is identical either way, so the same `CityState` shape works on both
 * threads. See DesignDocs/DESIGN.md "Data model".
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
import { type PrngState, seedPrng } from "./prng.ts";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CityState {
	readonly width: number;
	readonly height: number;
	readonly size: number; // width * height

	/** The single backing buffer all views below alias into. */
	readonly buffer: ArrayBufferLike;

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
	readonly densityCap: Uint8Array;
	readonly power: Uint8Array;
	readonly waterCoverage: Uint8Array;
	readonly civic: Uint8Array;
	readonly rail: Uint8Array;
	readonly powerLines: Uint8Array;
	readonly elevation: Uint8Array;

	// Aggregate scalars (indexed by AGG.*)
	readonly aggregates: Float64Array;

	// Deterministic PRNG (state is a view into the buffer)
	readonly rng: PrngState;
}

// ---------------------------------------------------------------------------
// Byte layout
// ---------------------------------------------------------------------------

const PRNG_WORDS = 4;
const U16_LAYER_COUNT = 3;
const U8_LAYER_COUNT = 13;

/** Round `offset` up to the next multiple of `align` (a power of two). */
function alignUp(offset: number, align: number): number {
	return Math.ceil(offset / align) * align;
}

interface Layout {
	readonly byteLength: number;
	readonly aggregates: number;
	readonly rng: number;
	readonly u16: number; // start of the u16 layers
	readonly u8: number; // start of the u8 layers
}

/**
 * Compute byte offsets for every section. Sections are ordered by decreasing
 * alignment requirement (f64 → u32 → u16 → u8) so each starts naturally
 * aligned regardless of grid size.
 */
function computeLayout(size: number): Layout {
	let offset = 0;

	const aggregates = offset;
	offset += AGG.COUNT * Float64Array.BYTES_PER_ELEMENT;

	const rng = alignUp(offset, Uint32Array.BYTES_PER_ELEMENT);
	offset = rng + PRNG_WORDS * Uint32Array.BYTES_PER_ELEMENT;

	const u16 = alignUp(offset, Uint16Array.BYTES_PER_ELEMENT);
	offset = u16 + U16_LAYER_COUNT * size * Uint16Array.BYTES_PER_ELEMENT;

	const u8 = offset; // u8 needs no alignment
	offset = u8 + U8_LAYER_COUNT * size * Uint8Array.BYTES_PER_ELEMENT;

	return { byteLength: offset, aggregates, rng, u16, u8 };
}

/** Total bytes a backing buffer must hold for a `width * height` grid. */
export function cityByteLength(width: number, height: number): number {
	return computeLayout(width * height).byteLength;
}

/**
 * Construct all typed-array views over `buffer` without writing any data.
 * The caller is responsible for initialization (see `createCity`).
 */
function viewLayout(
	buffer: ArrayBufferLike,
	width: number,
	height: number,
): CityState {
	const size = width * height;
	const layout = computeLayout(size);
	invariant(
		buffer.byteLength >= layout.byteLength,
		"city buffer too small for grid",
	);

	const u16 = layout.u16;
	const u8 = layout.u8;
	const u16Stride = size * Uint16Array.BYTES_PER_ELEMENT;
	const u8Stride = size * Uint8Array.BYTES_PER_ELEMENT;

	return {
		width,
		height,
		size,
		buffer,
		aggregates: new Float64Array(buffer, layout.aggregates, AGG.COUNT),
		rng: { s: new Uint32Array(buffer, layout.rng, PRNG_WORDS) },
		landValue: new Uint16Array(buffer, u16, size),
		population: new Uint16Array(buffer, u16 + u16Stride, size),
		jobs: new Uint16Array(buffer, u16 + 2 * u16Stride, size),
		terrain: new Uint8Array(buffer, u8, size),
		zoning: new Uint8Array(buffer, u8 + u8Stride, size),
		building: new Uint8Array(buffer, u8 + 2 * u8Stride, size),
		roads: new Uint8Array(buffer, u8 + 3 * u8Stride, size),
		pollution: new Uint8Array(buffer, u8 + 4 * u8Stride, size),
		traffic: new Uint8Array(buffer, u8 + 5 * u8Stride, size),
		densityCap: new Uint8Array(buffer, u8 + 6 * u8Stride, size),
		power: new Uint8Array(buffer, u8 + 7 * u8Stride, size),
		waterCoverage: new Uint8Array(buffer, u8 + 8 * u8Stride, size),
		civic: new Uint8Array(buffer, u8 + 9 * u8Stride, size),
		rail: new Uint8Array(buffer, u8 + 10 * u8Stride, size),
		powerLines: new Uint8Array(buffer, u8 + 11 * u8Stride, size),
		elevation: new Uint8Array(buffer, u8 + 12 * u8Stride, size),
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateCityOptions {
	width?: number;
	height?: number;
	seed?: number;
	/**
	 * Optional pre-allocated backing buffer (e.g. a `SharedArrayBuffer`). Must
	 * be at least `cityByteLength(width, height)` bytes. If omitted a private
	 * `ArrayBuffer` is allocated.
	 */
	buffer?: ArrayBufferLike;
}

/**
 * Allocate (or adopt) a backing buffer and initialize a fresh city: land
 * terrain, starting treasury, default tax rates, and a seeded PRNG.
 */
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

	const buffer = opts?.buffer ?? new ArrayBuffer(cityByteLength(width, height));
	const state = viewLayout(buffer, width, height);

	// Defaults. A fresh buffer is already zero-filled; an adopted buffer may not
	// be, so write every non-zero default explicitly.
	state.terrain.fill(TERRAIN_LAND);
	state.zoning.fill(0);
	state.building.fill(0);
	state.roads.fill(0);
	state.landValue.fill(0);
	state.population.fill(0);
	state.jobs.fill(0);
	state.pollution.fill(0);
	state.traffic.fill(0);
	state.densityCap.fill(0);
	state.power.fill(0);
	state.waterCoverage.fill(0);
	state.civic.fill(0);
	state.rail.fill(0);
	state.powerLines.fill(0);
	state.elevation.fill(0);
	state.aggregates.fill(0);

	state.aggregates[AGG.TREASURY] = STARTING_TREASURY;
	state.aggregates[AGG.TAX_RATE_R] = DEFAULT_TAX_RATE;
	state.aggregates[AGG.TAX_RATE_C] = DEFAULT_TAX_RATE;
	state.aggregates[AGG.TAX_RATE_I] = DEFAULT_TAX_RATE;

	seedPrng(state.rng, opts?.seed ?? 42);

	return state;
}

/**
 * Construct a `CityState` view over a buffer that is *already initialized*
 * (e.g. by the main thread before the worker adopted it). Does not touch the
 * data — used by the second thread to alias the same `SharedArrayBuffer`.
 */
export function viewCity(
	buffer: ArrayBufferLike,
	width: number,
	height: number,
): CityState {
	invariant(
		width > 0 && width <= MAX_GRID_SIZE,
		`width must be 1..${MAX_GRID_SIZE}`,
	);
	invariant(
		height > 0 && height <= MAX_GRID_SIZE,
		`height must be 1..${MAX_GRID_SIZE}`,
	);
	return viewLayout(buffer, width, height);
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
