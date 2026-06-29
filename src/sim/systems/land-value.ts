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
 */

import { type CityState, inBounds } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	LV_BASE,
	LV_COMMERCIAL_BONUS,
	LV_DIFFUSION_ITERATIONS,
	LV_DIFFUSION_RATE,
	LV_ELEVATION_FACTOR,
	LV_INDUSTRIAL_PENALTY,
	LV_NO_POWER_PENALTY,
	LV_NO_WATER_PENALTY,
	LV_POLLUTION_FACTOR,
	LV_POPULATION_BONUS,
	LV_RAIL_ADJ_BONUS,
	LV_ROAD_ADJ_BONUS,
	LV_WATER_ADJ_BONUS,
	MAX_GRID_SIZE,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

// Pre-allocated scratch buffer for diffusion passes.
const scratch = new Uint16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

// Orthogonal + diagonal neighbor offsets
const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;
const NEIGHBOR_COUNT = 8;

export function updateLandValue(state: CityState): void {
	const {
		width,
		height,
		size,
		terrain,
		zoning,
		building,
		roads,
		rail,
		pollution,
		landValue,
		elevation,
		power,
		waterCoverage,
	} = state;

	// --- Pass 1: compute raw values -----------------------------------------
	for (let i = 0; i < size; i++) {
		const x = i % width;
		const y = (i - x) / width;

		let value = LV_BASE;

		// Skip water
		if (terrain[i] === TERRAIN_WATER) {
			landValue[i] = 0;
			continue;
		}

		// Roads are infrastructure, not a taxable parcel
		if (roads[i] === 1) {
			landValue[i] = 0;
			continue;
		}

		// Rail and power lines are also infrastructure
		if (rail[i] === 1 || state.powerLines[i] === 1) {
			landValue[i] = 0;
			continue;
		}

		// Civic buildings have no taxable land value
		if ((state.civic[i] ?? 0) !== 0) {
			landValue[i] = 0;
			continue;
		}

		// Road-access premium
		let hasRoad = false;
		let hasRailNearby = false;
		let hasWaterfront = false;
		for (let n = 0; n < NEIGHBOR_COUNT; n++) {
			const nx = x + (DX[n] ?? 0);
			const ny = y + (DY[n] ?? 0);
			if (!inBounds(width, height, nx, ny)) continue;
			const ni = ny * width + nx;
			if (!hasRoad && roads[ni] === 1) hasRoad = true;
			if (!hasRailNearby && rail[ni] === 1) hasRailNearby = true;
			if (!hasWaterfront && terrain[ni] === TERRAIN_WATER) hasWaterfront = true;
		}

		if (hasRoad) value += LV_ROAD_ADJ_BONUS;
		if (hasRailNearby) value += LV_RAIL_ADJ_BONUS;
		if (hasWaterfront) value += LV_WATER_ADJ_BONUS;

		// Elevation bonus
		const elev = elevation[i] ?? 0;
		value += Math.floor(elev * LV_ELEVATION_FACTOR);

		// Nearby commercial boosts R land value; nearby population boosts C
		const zone = zoning[i];
		if (zone === ZONE_RESIDENTIAL || zone === ZONE_COMMERCIAL) {
			for (let n = 0; n < NEIGHBOR_COUNT; n++) {
				const nx = x + (DX[n] ?? 0);
				const ny = y + (DY[n] ?? 0);
				if (!inBounds(width, height, nx, ny)) continue;
				const ni = ny * width + nx;

				if (
					zone === ZONE_RESIDENTIAL &&
					zoning[ni] === ZONE_COMMERCIAL &&
					building[ni] !== BUILDING_EMPTY
				) {
					value += LV_COMMERCIAL_BONUS;
				}
				if (
					zone === ZONE_COMMERCIAL &&
					zoning[ni] === ZONE_RESIDENTIAL &&
					building[ni] !== BUILDING_EMPTY
				) {
					value += LV_POPULATION_BONUS;
				}
			}
		}

		// Industrial penalty
		if (zone !== ZONE_INDUSTRIAL) {
			for (let n = 0; n < NEIGHBOR_COUNT; n++) {
				const nx = x + (DX[n] ?? 0);
				const ny = y + (DY[n] ?? 0);
				if (!inBounds(width, height, nx, ny)) continue;
				const ni = ny * width + nx;
				if (zoning[ni] === ZONE_INDUSTRIAL && building[ni] !== BUILDING_EMPTY) {
					value -= LV_INDUSTRIAL_PENALTY;
				}
			}
		}

		// Pollution penalty
		const pol = pollution[i] ?? 0;
		value -= pol * LV_POLLUTION_FACTOR;

		// Power/water coverage penalties
		if (power[i] !== 1) value -= LV_NO_POWER_PENALTY;
		if (waterCoverage[i] !== 1) value -= LV_NO_WATER_PENALTY;

		landValue[i] = Math.max(0, value);
	}

	// --- Pass 2: diffusion (bounded iterations) ------------------------------
	for (let iter = 0; iter < LV_DIFFUSION_ITERATIONS; iter++) {
		scratch.set(landValue);

		for (let i = 0; i < size; i++) {
			// Water, roads, rail, power lines are not part of the value field.
			if (terrain[i] === TERRAIN_WATER) continue;
			if (roads[i] === 1 || rail[i] === 1 || state.powerLines[i] === 1)
				continue;
			if ((state.civic[i] ?? 0) !== 0) continue;

			const x = i % width;
			const y = (i - x) / width;

			let sum = 0;
			let count = 0;

			for (let n = 0; n < NEIGHBOR_COUNT; n++) {
				const nx = x + (DX[n] ?? 0);
				const ny = y + (DY[n] ?? 0);
				if (inBounds(width, height, nx, ny)) {
					const ni = ny * width + nx;
					if (roads[ni] === 1 || rail[ni] === 1) continue;
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
