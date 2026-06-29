/**
 * Migration — buildings appear on zoned land when demand is positive,
 * and are abandoned when demand is deeply negative.
 *
 * Growth picks the highest land-value empty zoned tiles first.
 * Abandonment picks the lowest land-value occupied tiles first.
 *
 * Buildings start at density tier 1 (low) and upgrade toward the player's
 * density cap when demand stays high.
 *
 * Development requires power coverage. Without power a tile will not grow
 * or upgrade.
 */

import type { CityState } from "../city-state.ts";
import {
	ABANDON_DEMAND_THRESHOLD,
	AGG,
	BUILDING_EMPTY,
	BUILDING_LOW,
	DENSITY_LOW,
	GROWTH_DEMAND_THRESHOLD,
	JOBS_C_PER_DENSITY,
	JOBS_I_PER_DENSITY,
	MAX_ABANDONS_PER_TICK,
	MAX_BUILDS_PER_TICK,
	MAX_GRID_SIZE,
	MAX_UPGRADES_PER_TICK,
	POP_PER_DENSITY,
	TERRAIN_WATER,
	UPGRADE_DEMAND_THRESHOLD,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

// Pre-allocated scratch arrays for candidate tile selection.
const MAX_TILES = MAX_GRID_SIZE * MAX_GRID_SIZE;
const candIdx = new Uint32Array(MAX_TILES);
const candVal = new Uint16Array(MAX_TILES);

export function processMigration(state: CityState): void {
	const rDemand = state.aggregates[AGG.R_DEMAND] ?? 0;
	const cDemand = state.aggregates[AGG.C_DEMAND] ?? 0;
	const iDemand = state.aggregates[AGG.I_DEMAND] ?? 0;

	growZone(state, ZONE_RESIDENTIAL, rDemand);
	growZone(state, ZONE_COMMERCIAL, cDemand);
	growZone(state, ZONE_INDUSTRIAL, iDemand);

	upgradeZone(state, ZONE_RESIDENTIAL, rDemand);
	upgradeZone(state, ZONE_COMMERCIAL, cDemand);
	upgradeZone(state, ZONE_INDUSTRIAL, iDemand);

	abandonZone(state, ZONE_RESIDENTIAL, rDemand);
	abandonZone(state, ZONE_COMMERCIAL, cDemand);
	abandonZone(state, ZONE_INDUSTRIAL, iDemand);
}

function growZone(state: CityState, zoneType: number, demand: number): void {
	if (demand < GROWTH_DEMAND_THRESHOLD) return;

	const { size, terrain, zoning, building, landValue, power } = state;

	// Collect empty zoned tiles that have road access and power
	let count = 0;
	for (let i = 0; i < size; i++) {
		if (
			zoning[i] === zoneType &&
			building[i] === BUILDING_EMPTY &&
			terrain[i] !== TERRAIN_WATER &&
			power[i] === 1 &&
			hasRoadAccess(state, i)
		) {
			candIdx[count] = i;
			candVal[count] = landValue[i] ?? 0;
			count++;
		}
	}

	if (count === 0) return;

	// Scale builds by demand magnitude
	const demandFactor = Math.min(1, (demand - GROWTH_DEMAND_THRESHOLD) / 200);
	const maxBuilds = Math.max(1, Math.floor(MAX_BUILDS_PER_TICK * demandFactor));
	const buildCount = Math.min(maxBuilds, count);

	// Partial selection sort: place highest-value tiles at front
	selectTopK(count, buildCount);

	for (let i = 0; i < buildCount; i++) {
		const idx = candIdx[i] ?? 0;

		building[idx] = BUILDING_LOW;

		if (zoneType === ZONE_RESIDENTIAL) {
			state.population[idx] = POP_PER_DENSITY[BUILDING_LOW] ?? 0;
			state.jobs[idx] = 0;
		} else if (zoneType === ZONE_COMMERCIAL) {
			state.population[idx] = 0;
			state.jobs[idx] = JOBS_C_PER_DENSITY[BUILDING_LOW] ?? 0;
		} else if (zoneType === ZONE_INDUSTRIAL) {
			state.population[idx] = 0;
			state.jobs[idx] = JOBS_I_PER_DENSITY[BUILDING_LOW] ?? 0;
		}
	}
}

function upgradeZone(state: CityState, zoneType: number, demand: number): void {
	if (demand < UPGRADE_DEMAND_THRESHOLD) return;

	const { size, zoning, building, densityCap, landValue, power } = state;

	// Collect occupied tiles below their density cap with power
	let count = 0;
	for (let i = 0; i < size; i++) {
		const cap = densityCap[i] ?? DENSITY_LOW;
		if (
			zoning[i] === zoneType &&
			building[i] !== BUILDING_EMPTY &&
			(building[i] ?? 0) < cap &&
			power[i] === 1
		) {
			candIdx[count] = i;
			candVal[count] = landValue[i] ?? 0;
			count++;
		}
	}

	if (count === 0) return;

	const upgradeCount = Math.min(MAX_UPGRADES_PER_TICK, count);
	selectTopK(count, upgradeCount);

	for (let i = 0; i < upgradeCount; i++) {
		const idx = candIdx[i] ?? 0;
		const nextTier = (building[idx] ?? 0) + 1;
		building[idx] = nextTier;

		if (zoneType === ZONE_RESIDENTIAL) {
			state.population[idx] = POP_PER_DENSITY[nextTier] ?? 0;
			state.jobs[idx] = 0;
		} else if (zoneType === ZONE_COMMERCIAL) {
			state.population[idx] = 0;
			state.jobs[idx] = JOBS_C_PER_DENSITY[nextTier] ?? 0;
		} else if (zoneType === ZONE_INDUSTRIAL) {
			state.population[idx] = 0;
			state.jobs[idx] = JOBS_I_PER_DENSITY[nextTier] ?? 0;
		}
	}
}

function abandonZone(state: CityState, zoneType: number, demand: number): void {
	if (demand > ABANDON_DEMAND_THRESHOLD) return;

	const { size, zoning, building, landValue } = state;

	// Collect occupied tiles of this zone type
	let count = 0;
	for (let i = 0; i < size; i++) {
		if (zoning[i] === zoneType && building[i] !== BUILDING_EMPTY) {
			candIdx[count] = i;
			candVal[count] = landValue[i] ?? 0;
			count++;
		}
	}

	if (count === 0) return;

	const abandonCount = Math.min(MAX_ABANDONS_PER_TICK, count);

	// Partial selection sort: place lowest-value tiles at front
	selectBottomK(count, abandonCount);

	for (let i = 0; i < abandonCount; i++) {
		const idx = candIdx[i] ?? 0;

		building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
	}
}

/** Partial selection sort: places the largest `k` values at indices 0..k-1. */
function selectTopK(count: number, k: number): void {
	const limit = Math.min(k, count);
	for (let i = 0; i < limit; i++) {
		let bestJ = i;
		for (let j = i + 1; j < count; j++) {
			if ((candVal[j] ?? 0) > (candVal[bestJ] ?? 0)) {
				bestJ = j;
			}
		}
		if (bestJ !== i) {
			const tmpIdx = candIdx[i] ?? 0;
			const tmpVal = candVal[i] ?? 0;
			candIdx[i] = candIdx[bestJ] ?? 0;
			candVal[i] = candVal[bestJ] ?? 0;
			candIdx[bestJ] = tmpIdx;
			candVal[bestJ] = tmpVal;
		}
	}
}

/** Partial selection sort: places the smallest `k` values at indices 0..k-1. */
function selectBottomK(count: number, k: number): void {
	const limit = Math.min(k, count);
	for (let i = 0; i < limit; i++) {
		let bestJ = i;
		for (let j = i + 1; j < count; j++) {
			if ((candVal[j] ?? 0) < (candVal[bestJ] ?? 0)) {
				bestJ = j;
			}
		}
		if (bestJ !== i) {
			const tmpIdx = candIdx[i] ?? 0;
			const tmpVal = candVal[i] ?? 0;
			candIdx[i] = candIdx[bestJ] ?? 0;
			candVal[i] = candVal[bestJ] ?? 0;
			candIdx[bestJ] = tmpIdx;
			candVal[bestJ] = tmpVal;
		}
	}
}

function hasRoadAccess(state: CityState, index: number): boolean {
	const { width, height, roads } = state;
	const x = index % width;
	const y = (index - x) / width;

	// Check 4 orthogonal neighbors for road
	if (x > 0 && roads[index - 1] === 1) return true;
	if (x < width - 1 && roads[index + 1] === 1) return true;
	if (y > 0 && roads[index - width] === 1) return true;
	if (y < height - 1 && roads[index + width] === 1) return true;

	return false;
}
