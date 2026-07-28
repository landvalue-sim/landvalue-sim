/**
 * Land value field — amenity capitalization and diffusion.
 *
 * Each tile's land value is computed from:
 *   - Base terrain value
 *   - Road access (on road or adjacent to road)
 *   - Rail adjacency (transit capitalization)
 *   - Waterfront adjacency
 *   - Elevation bonus
 *   - Nearby commercial activity (positive for R tiles)
 *   - Nearby population (positive for C tiles)
 *   - Industrial proximity (negative)
 *   - Pollution (negative)
 *   - Power/water coverage penalties
 *
 * After raw values are computed, a diffusion pass smooths the field so
 * value radiates outward from amenities.
 *
 * The per-tile facts every neighbor scan needs (infrastructure, amenities,
 * occupied zoning) are packed into flag bytes once per update, and the grid
 * interior runs a fast path with precomputed neighbor offsets and no bounds
 * checks — only the border rows and columns pay for coordinate clamping.
 * The arithmetic is unchanged from the straightforward implementation; only
 * the traversal is restructured (issue #11).
 */

import { type CityState, inBounds } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	CIVIC_PARK,
	CIVIC_STADIUM,
	LV_BASE,
	LV_COMMERCIAL_BONUS,
	LV_CRIME_FACTOR,
	LV_DIFFUSION_ITERATIONS,
	LV_DIFFUSION_RATE,
	LV_ELEVATION_FACTOR,
	LV_INDUSTRIAL_PENALTY,
	LV_NO_POWER_PENALTY,
	LV_NO_WATER_PENALTY,
	LV_PARK_BONUS,
	LV_POLLUTION_FACTOR,
	LV_POPULATION_BONUS,
	LV_RAIL_ADJ_BONUS,
	LV_ROAD_ADJ_BONUS,
	LV_STADIUM_BONUS,
	LV_TRAFFIC_FACTOR,
	LV_WATER_ADJ_BONUS,
	MAX_GRID_SIZE,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

// Pre-allocated scratch buffer for diffusion passes.
const scratch = new Uint16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

// Per-tile fact flags, rebuilt once per update.
const F_ROAD = 1;
const F_RAIL = 2;
const F_WATER = 4;
const F_PARK = 8;
const F_STADIUM = 16;
const F_PLINE = 32;
const F_CIVIC = 64;
// A tile with any of these is infrastructure/water, carries no parcel value,
// and sits outside the diffusion field. (Same set in both passes.)
const F_NOT_PARCEL = F_ROAD | F_RAIL | F_WATER | F_PLINE | F_CIVIC;
// Neighbors skipped when averaging during diffusion.
const F_SUM_SKIP = F_ROAD | F_RAIL;

const tileFlags = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
// Zoning of tiles that actually have a building; ZONE_NONE otherwise.
const zoneBuilt = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

// Orthogonal + diagonal neighbor offsets
const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;
const NEIGHBOR_COUNT = 8;

// Flat neighbor offsets for the current width (interior fast path).
const flatOffsets = new Int32Array(NEIGHBOR_COUNT);

export function updateLandValue(state: CityState): void {
	const { width, height } = state;

	for (let n = 0; n < NEIGHBOR_COUNT; n++) {
		flatOffsets[n] = (DY[n] ?? 0) * width + (DX[n] ?? 0);
	}

	buildTileIndex(state);

	// --- Pass 1: compute raw values -----------------------------------------
	for (let y = 0; y < height; y++) {
		const interiorRow = y > 0 && y < height - 1;
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			if (((tileFlags[i] ?? 0) & F_NOT_PARCEL) !== 0) {
				state.landValue[i] = 0;
				continue;
			}
			if (interiorRow && x > 0 && x < width - 1) {
				state.landValue[i] = rawValueInterior(state, i);
			} else {
				state.landValue[i] = rawValueBorder(state, i, x, y);
			}
		}
	}

	// --- Pass 2: diffusion (bounded iterations) ------------------------------
	for (let iter = 0; iter < LV_DIFFUSION_ITERATIONS; iter++) {
		scratch.set(state.landValue);
		diffuseOnce(state);
	}
}

/** Rebuild the per-tile fact flags and occupied-zoning index. */
function buildTileIndex(state: CityState): void {
	const { size, terrain, roads, rail, powerLines, civic, zoning, building } =
		state;

	for (let i = 0; i < size; i++) {
		let flags = 0;
		if (roads[i] === 1) flags |= F_ROAD;
		if (rail[i] === 1) flags |= F_RAIL;
		if (terrain[i] === TERRAIN_WATER) flags |= F_WATER;
		if (powerLines[i] === 1) flags |= F_PLINE;
		const c = civic[i] ?? 0;
		if (c !== 0) flags |= F_CIVIC;
		if (c === CIVIC_PARK) flags |= F_PARK;
		if (c === CIVIC_STADIUM) flags |= F_STADIUM;
		tileFlags[i] = flags;
		zoneBuilt[i] = building[i] === BUILDING_EMPTY ? 0 : (zoning[i] ?? 0);
	}
}

/** Raw value for an interior tile: neighbor indices need no bounds checks. */
function rawValueInterior(state: CityState, i: number): number {
	let nearFlags = 0;
	let cCount = 0;
	let rCount = 0;
	let iCount = 0;
	let maxTraffic = 0;

	for (let n = 0; n < NEIGHBOR_COUNT; n++) {
		const ni = i + (flatOffsets[n] ?? 0);
		nearFlags |= tileFlags[ni] ?? 0;
		const zb = zoneBuilt[ni];
		if (zb === ZONE_COMMERCIAL) cCount++;
		else if (zb === ZONE_RESIDENTIAL) rCount++;
		else if (zb === ZONE_INDUSTRIAL) iCount++;
		const t = state.traffic[ni] ?? 0;
		if (t > maxTraffic) maxTraffic = t;
	}

	return finishValue(state, i, nearFlags, cCount, rCount, iCount, maxTraffic);
}

/** Raw value for a border tile: the same scan with bounds-checked neighbors. */
function rawValueBorder(
	state: CityState,
	i: number,
	x: number,
	y: number,
): number {
	const { width, height } = state;
	let nearFlags = 0;
	let cCount = 0;
	let rCount = 0;
	let iCount = 0;
	let maxTraffic = 0;

	for (let n = 0; n < NEIGHBOR_COUNT; n++) {
		const nx = x + (DX[n] ?? 0);
		const ny = y + (DY[n] ?? 0);
		if (!inBounds(width, height, nx, ny)) continue;
		const ni = ny * width + nx;
		nearFlags |= tileFlags[ni] ?? 0;
		const zb = zoneBuilt[ni];
		if (zb === ZONE_COMMERCIAL) cCount++;
		else if (zb === ZONE_RESIDENTIAL) rCount++;
		else if (zb === ZONE_INDUSTRIAL) iCount++;
		const t = state.traffic[ni] ?? 0;
		if (t > maxTraffic) maxTraffic = t;
	}

	return finishValue(state, i, nearFlags, cCount, rCount, iCount, maxTraffic);
}

/** Combine the neighbor-scan facts with the tile's own into a raw value. */
function finishValue(
	state: CityState,
	i: number,
	nearFlags: number,
	cCount: number,
	rCount: number,
	iCount: number,
	maxTraffic: number,
): number {
	let value = LV_BASE;

	if ((nearFlags & F_ROAD) !== 0) value += LV_ROAD_ADJ_BONUS;
	if ((nearFlags & F_RAIL) !== 0) value += LV_RAIL_ADJ_BONUS;
	if ((nearFlags & F_WATER) !== 0) value += LV_WATER_ADJ_BONUS;
	if ((nearFlags & F_PARK) !== 0) value += LV_PARK_BONUS;
	if ((nearFlags & F_STADIUM) !== 0) value += LV_STADIUM_BONUS;

	// Elevation bonus
	const elev = state.elevation[i] ?? 0;
	value += Math.floor(elev * LV_ELEVATION_FACTOR);

	// Nearby commercial boosts R land value; nearby population boosts C
	const zone = state.zoning[i];
	if (zone === ZONE_RESIDENTIAL) value += cCount * LV_COMMERCIAL_BONUS;
	if (zone === ZONE_COMMERCIAL) value += rCount * LV_POPULATION_BONUS;

	// Industrial penalty
	if (zone !== ZONE_INDUSTRIAL) value -= iCount * LV_INDUSTRIAL_PENALTY;

	// Pollution penalty
	value -= (state.pollution[i] ?? 0) * LV_POLLUTION_FACTOR;

	// Crime penalty
	value -= Math.floor((state.crime[i] ?? 0) * LV_CRIME_FACTOR);

	// Traffic penalty (from adjacent road congestion)
	value -= Math.floor(maxTraffic * LV_TRAFFIC_FACTOR);

	// Power/water coverage penalties
	if (state.power[i] !== 1) value -= LV_NO_POWER_PENALTY;
	if (state.waterCoverage[i] !== 1) value -= LV_NO_WATER_PENALTY;

	return Math.max(0, value);
}

/** One diffusion iteration: average each parcel toward its neighbors. */
function diffuseOnce(state: CityState): void {
	const { width, height, landValue } = state;

	for (let y = 0; y < height; y++) {
		const interiorRow = y > 0 && y < height - 1;
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			// Water, roads, rail, power lines are not part of the value field.
			if (((tileFlags[i] ?? 0) & F_NOT_PARCEL) !== 0) continue;

			let sum = 0;
			let count = 0;
			if (interiorRow && x > 0 && x < width - 1) {
				for (let n = 0; n < NEIGHBOR_COUNT; n++) {
					const ni = i + (flatOffsets[n] ?? 0);
					if (((tileFlags[ni] ?? 0) & F_SUM_SKIP) !== 0) continue;
					sum += scratch[ni] ?? 0;
					count++;
				}
			} else {
				for (let n = 0; n < NEIGHBOR_COUNT; n++) {
					const nx = x + (DX[n] ?? 0);
					const ny = y + (DY[n] ?? 0);
					if (!inBounds(width, height, nx, ny)) continue;
					const ni = ny * width + nx;
					if (((tileFlags[ni] ?? 0) & F_SUM_SKIP) !== 0) continue;
					sum += scratch[ni] ?? 0;
					count++;
				}
			}

			if (count > 0) {
				const avg = sum / count;
				const current = scratch[i] ?? 0;
				landValue[i] = Math.round(
					current + (avg - current) * LV_DIFFUSION_RATE,
				);
			}
		}
	}
}
