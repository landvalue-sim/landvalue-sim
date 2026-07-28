/**
 * Power system — compute power coverage via BFS flood fill from power plants.
 *
 * Power flows from plants through roads, rail, power lines, civic buildings,
 * and zoned tiles. Unconnected tiles are unpowered.
 *
 * Capacity falls off with network distance rather than failing all at once:
 * the flood fill serves tiles nearest-first and stops where capacity runs out,
 * so an under-built grid browns out its outskirts while the core stays lit.
 * See `utility-network.ts` for the walk itself.
 *
 * Buildings grow without power but suffer land-value penalties. With no
 * power plants placed, no tile is powered.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_NONE,
	MAX_GRID_SIZE,
	POWER_DEMAND_PER_DENSITY,
	POWER_OUTPUT,
	TERRAIN_WATER,
} from "../constants.ts";
import {
	clearCoverage,
	floodCoverage,
	type NetworkSpec,
} from "./utility-network.ts";

// Seed buffer for the flood fill: every plant on the grid, worst case.
const plantSeeds = new Uint32Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

/** A tile conducts power if it has infrastructure, a civic building, or zoning. */
function conductsPower(state: CityState, idx: number): boolean {
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.roads[idx] === 1) return true;
	if (state.rail[idx] === 1) return true;
	if (state.powerLines[idx] === 1) return true;
	if ((state.civic[idx] ?? 0) !== CIVIC_NONE) return true;
	if ((state.zoning[idx] ?? 0) !== 0) return true;
	return false;
}

/** Only occupied buildings draw power; conduits and empty land draw nothing. */
function powerDemandAt(state: CityState, idx: number): number {
	const tier = state.building[idx] ?? 0;
	if (tier === BUILDING_EMPTY) return 0;
	return POWER_DEMAND_PER_DENSITY[tier] ?? 0;
}

const POWER_NETWORK: NetworkSpec = {
	conducts: conductsPower,
	demandAt: powerDemandAt,
};

export function updatePower(state: CityState): void {
	const { size, civic, building, power, aggregates } = state;
	// Hoisted imported constants: under Vite's dev/test module transform an
	// imported binding is a namespace property read on every use, which is
	// ruinous inside per-tile loops. Locals compile to registers everywhere.
	const outputs = POWER_OUTPUT;
	const demandPerDensity = POWER_DEMAND_PER_DENSITY;
	const empty = BUILDING_EMPTY;

	let totalCapacity = 0;
	let totalDemand = 0;
	let seedCount = 0;

	// Tally demand and collect power plants as flood-fill seeds.
	for (let i = 0; i < size; i++) {
		const c = civic[i] ?? 0;
		const output = outputs[c];
		if (output !== undefined && output > 0) {
			totalCapacity += output;
			plantSeeds[seedCount] = i;
			seedCount++;
		}
		const tier = building[i] ?? 0;
		if (tier !== empty) {
			totalDemand += demandPerDensity[tier] ?? 0;
		}
	}

	aggregates[AGG.POWER_CAPACITY] = totalCapacity;
	aggregates[AGG.POWER_DEMAND] = totalDemand;

	// No plants: nothing is powered.
	if (seedCount === 0) {
		clearCoverage(power, size);
		aggregates[AGG.POWER_SERVED] = 0;
		return;
	}

	aggregates[AGG.POWER_SERVED] = floodCoverage(
		state,
		plantSeeds,
		seedCount,
		POWER_NETWORK,
		totalCapacity,
		power,
	);
}
