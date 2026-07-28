/**
 * Water system — BFS network-based coverage from water pumps.
 *
 * Water pumps must be adjacent to a water tile to function. Each active pump
 * seeds a BFS flood-fill that spreads through water pipes, roads, civic
 * buildings, and zoned tiles — the same graph pattern as the power system.
 *
 * Roads carry water implicitly (underground utilities), so a road network
 * connected to an active pump provides water coverage for free. Dedicated
 * water pipes exist to link a pump that sits away from that network — a
 * shoreline pump reaching back to the city — and to let the player route
 * supply deliberately rather than by accident of where roads happen to run.
 *
 * Capacity: each active pump supplies WATER_OUTPUT_PER_PUMP units, and supply
 * falls off with network distance exactly as power does — the fill serves the
 * nearest tiles first and dries up at the frontier where capacity runs out.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_NONE,
	CIVIC_WATER_PUMP,
	MAX_GRID_SIZE,
	TERRAIN_WATER,
	WATER_DEMAND_PER_DENSITY,
	WATER_OUTPUT_PER_PUMP,
} from "../constants.ts";
import {
	clearCoverage,
	floodCoverage,
	type NetworkSpec,
} from "./utility-network.ts";

// Seed buffer for the flood fill: every pump on the grid, worst case.
const pumpSeeds = new Uint32Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

/** A tile conducts water if it has a pipe, road, civic building, or zoning. */
function conductsWater(state: CityState, idx: number): boolean {
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.waterPipes[idx] === 1) return true;
	if (state.roads[idx] === 1) return true;
	if ((state.civic[idx] ?? 0) !== CIVIC_NONE) return true;
	if ((state.zoning[idx] ?? 0) !== 0) return true;
	return false;
}

/** Only occupied buildings draw water; conduits and empty land draw nothing. */
function waterDemandAt(state: CityState, idx: number): number {
	const tier = state.building[idx] ?? 0;
	if (tier === BUILDING_EMPTY) return 0;
	return WATER_DEMAND_PER_DENSITY[tier] ?? 0;
}

const WATER_NETWORK: NetworkSpec = {
	conducts: conductsWater,
	demandAt: waterDemandAt,
};

/** A pump only draws if it sits orthogonally adjacent to water terrain. */
function pumpIsActive(state: CityState, idx: number): boolean {
	const { width, height, terrain } = state;
	const x = idx % width;
	const y = (idx - x) / width;
	if (x > 0 && terrain[idx - 1] === TERRAIN_WATER) return true;
	if (x < width - 1 && terrain[idx + 1] === TERRAIN_WATER) return true;
	if (y > 0 && terrain[idx - width] === TERRAIN_WATER) return true;
	if (y < height - 1 && terrain[idx + width] === TERRAIN_WATER) return true;
	return false;
}

export function updateWater(state: CityState): void {
	const { size, civic, building, waterCoverage, aggregates } = state;
	// Hoisted imported constants: under Vite's dev/test module transform an
	// imported binding is a namespace property read on every use, which is
	// ruinous inside per-tile loops. Locals compile to registers everywhere.
	const pump = CIVIC_WATER_PUMP;
	const empty = BUILDING_EMPTY;
	const demandPerDensity = WATER_DEMAND_PER_DENSITY;

	let activePumps = 0;
	let totalDemand = 0;
	let seedCount = 0;

	// Tally demand and collect active pumps as flood-fill seeds.
	for (let i = 0; i < size; i++) {
		if (civic[i] === pump && pumpIsActive(state, i)) {
			activePumps++;
			pumpSeeds[seedCount] = i;
			seedCount++;
		}
		const tier = building[i] ?? 0;
		if (tier !== empty) {
			totalDemand += demandPerDensity[tier] ?? 0;
		}
	}

	const totalCapacity = activePumps * WATER_OUTPUT_PER_PUMP;

	aggregates[AGG.WATER_DEMAND] = totalDemand;
	aggregates[AGG.WATER_CAPACITY] = totalCapacity;

	// No active pumps: nothing is covered.
	if (seedCount === 0) {
		clearCoverage(waterCoverage, size);
		aggregates[AGG.WATER_SERVED] = 0;
		return;
	}

	aggregates[AGG.WATER_SERVED] = floodCoverage(
		state,
		pumpSeeds,
		seedCount,
		WATER_NETWORK,
		totalCapacity,
		waterCoverage,
	);
}
