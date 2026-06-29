/**
 * Power system — compute power coverage via BFS flood fill from power plants.
 *
 * Power flows from plants through roads, rail, power lines, civic buildings,
 * and zoned tiles. Unconnected tiles are unpowered. If total capacity < total
 * demand, all tiles lose power (brownout).
 *
 * Progressive disclosure: if no power plants exist yet, all tiles are
 * considered powered so the early game works without infrastructure.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_NONE,
	MAX_GRID_SIZE,
	POWER_DEMAND_PER_BUILDING,
	POWER_OUTPUT,
	TERRAIN_WATER,
} from "../constants.ts";

const MAX_TILES = MAX_GRID_SIZE * MAX_GRID_SIZE;
const bfsQueue = new Uint32Array(MAX_TILES);
const visited = new Uint8Array(MAX_TILES);

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

export function updatePower(state: CityState): void {
	const { width, height, size, civic, building, power, aggregates } = state;

	let hasPlants = false;
	let totalCapacity = 0;
	let totalDemand = 0;
	let head = 0;
	let tail = 0;

	// Clear visited
	for (let i = 0; i < size; i++) {
		visited[i] = 0;
	}

	// Tally demand and seed BFS with power plants
	for (let i = 0; i < size; i++) {
		const c = civic[i] ?? 0;
		const output = POWER_OUTPUT[c];
		if (output !== undefined && output > 0) {
			hasPlants = true;
			totalCapacity += output;
			visited[i] = 1;
			bfsQueue[tail] = i;
			tail++;
		}
		if (building[i] !== BUILDING_EMPTY) {
			totalDemand += POWER_DEMAND_PER_BUILDING;
		}
	}

	aggregates[AGG.POWER_CAPACITY] = totalCapacity;
	aggregates[AGG.POWER_DEMAND] = totalDemand;

	// No plants placed yet: everything is powered (pre-industrial era)
	if (!hasPlants) {
		for (let i = 0; i < size; i++) {
			power[i] = 1;
		}
		return;
	}

	// Reset power coverage
	for (let i = 0; i < size; i++) {
		power[i] = 0;
	}

	// Brownout: demand exceeds capacity, nothing is powered
	if (totalDemand > totalCapacity) return;

	// BFS flood fill through conducting tiles
	let steps = 0;
	while (head < tail && steps < MAX_TILES) {
		steps++;
		const idx = bfsQueue[head] ?? 0;
		head++;
		power[idx] = 1;

		const x = idx % width;
		const y = (idx - x) / width;

		if (x > 0) {
			const ni = idx - 1;
			if (visited[ni] !== 1 && conductsPower(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (x < width - 1) {
			const ni = idx + 1;
			if (visited[ni] !== 1 && conductsPower(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (y > 0) {
			const ni = idx - width;
			if (visited[ni] !== 1 && conductsPower(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (y < height - 1) {
			const ni = idx + width;
			if (visited[ni] !== 1 && conductsPower(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
	}
}
