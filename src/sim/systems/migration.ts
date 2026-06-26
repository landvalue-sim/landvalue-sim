/**
 * Migration — buildings appear on zoned land when demand is positive,
 * and are abandoned when demand is deeply negative.
 *
 * Growth picks the highest land-value empty zoned tiles first.
 * Abandonment picks the lowest land-value occupied tiles first.
 *
 * For the MVP all new buildings are density tier 1 (low).
 */

import type { CityState } from "../city-state.ts";
import {
	ABANDON_DEMAND_THRESHOLD,
	AGG,
	BUILDING_EMPTY,
	BUILDING_LOW,
	GROWTH_DEMAND_THRESHOLD,
	JOBS_C_PER_DENSITY,
	JOBS_I_PER_DENSITY,
	MAX_ABANDONS_PER_TICK,
	MAX_BUILDS_PER_TICK,
	POP_PER_DENSITY,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

interface TileScore {
	index: number;
	value: number;
}

// Pre-allocated scratch arrays to avoid per-tick allocation.
// Sized for max possible grid (256×256 = 65536).
const candidates: TileScore[] = [];

export function processMigration(state: CityState): void {
	const rDemand = state.aggregates[AGG.R_DEMAND] ?? 0;
	const cDemand = state.aggregates[AGG.C_DEMAND] ?? 0;
	const iDemand = state.aggregates[AGG.I_DEMAND] ?? 0;

	growZone(state, ZONE_RESIDENTIAL, rDemand);
	growZone(state, ZONE_COMMERCIAL, cDemand);
	growZone(state, ZONE_INDUSTRIAL, iDemand);

	abandonZone(state, ZONE_RESIDENTIAL, rDemand);
	abandonZone(state, ZONE_COMMERCIAL, cDemand);
	abandonZone(state, ZONE_INDUSTRIAL, iDemand);
}

function growZone(state: CityState, zoneType: number, demand: number): void {
	if (demand < GROWTH_DEMAND_THRESHOLD) return;

	const { size, terrain, zoning, building, landValue } = state;

	// Collect empty zoned tiles that have road access
	candidates.length = 0;
	for (let i = 0; i < size; i++) {
		if (
			zoning[i] === zoneType &&
			building[i] === BUILDING_EMPTY &&
			terrain[i] !== TERRAIN_WATER &&
			hasRoadAccess(state, i)
		) {
			candidates.push({ index: i, value: landValue[i] ?? 0 });
		}
	}

	// Sort by land value descending (highest value first)
	candidates.sort((a, b) => b.value - a.value);

	// Scale builds by demand magnitude
	const demandFactor = Math.min(1, (demand - GROWTH_DEMAND_THRESHOLD) / 200);
	const maxBuilds = Math.max(1, Math.floor(MAX_BUILDS_PER_TICK * demandFactor));
	const buildCount = Math.min(maxBuilds, candidates.length);

	for (let i = 0; i < buildCount; i++) {
		const tile = candidates[i];
		if (tile === undefined) break;
		const idx = tile.index;

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

function abandonZone(state: CityState, zoneType: number, demand: number): void {
	if (demand > ABANDON_DEMAND_THRESHOLD) return;

	const { size, zoning, building, landValue } = state;

	// Collect occupied tiles of this zone type
	candidates.length = 0;
	for (let i = 0; i < size; i++) {
		if (zoning[i] === zoneType && building[i] !== BUILDING_EMPTY) {
			candidates.push({ index: i, value: landValue[i] ?? 0 });
		}
	}

	// Sort by land value ascending (lowest value abandoned first)
	candidates.sort((a, b) => a.value - b.value);

	const abandonCount = Math.min(MAX_ABANDONS_PER_TICK, candidates.length);

	for (let i = 0; i < abandonCount; i++) {
		const tile = candidates[i];
		if (tile === undefined) break;
		const idx = tile.index;

		building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
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
