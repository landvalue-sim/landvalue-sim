/**
 * Water system — BFS network-based coverage from water pumps.
 *
 * Water pumps must be adjacent to a water tile to function. Each active pump
 * seeds a BFS flood-fill that spreads through water pipes, roads, civic
 * buildings, and zoned tiles — the same graph pattern as the power system.
 *
 * Roads carry water implicitly (underground utilities), so a road network
 * connected to an active pump provides water coverage for free. Dedicated
 * water pipes extend the network to areas roads don't reach.
 *
 * Progressive disclosure: if no water pumps exist yet, all tiles are
 * considered covered so the early game works without infrastructure.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_NONE,
	CIVIC_WATER_PUMP,
	MAX_GRID_SIZE,
	TERRAIN_WATER,
} from "../constants.ts";

const MAX_TILES = MAX_GRID_SIZE * MAX_GRID_SIZE;
const bfsQueue = new Uint32Array(MAX_TILES);
const visited = new Uint8Array(MAX_TILES);

/** A tile conducts water if it has a pipe, road, civic building, or zoning. */
function conductsWater(state: CityState, idx: number): boolean {
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.waterPipes[idx] === 1) return true;
	if (state.roads[idx] === 1) return true;
	if ((state.civic[idx] ?? 0) !== CIVIC_NONE) return true;
	if ((state.zoning[idx] ?? 0) !== 0) return true;
	return false;
}

export function updateWater(state: CityState): void {
	const {
		width,
		height,
		size,
		civic,
		terrain,
		building,
		waterCoverage,
		aggregates,
	} = state;

	let hasPumps = false;
	let activePumps = 0;
	let totalDemand = 0;
	let head = 0;
	let tail = 0;

	// Clear visited
	for (let i = 0; i < size; i++) {
		visited[i] = 0;
	}

	// Check for any water pumps and tally demand
	for (let i = 0; i < size; i++) {
		if (civic[i] === CIVIC_WATER_PUMP) {
			hasPumps = true;

			const px = i % width;
			const py = (i - px) / width;

			// Pump is active only if adjacent to water (orthogonal)
			let nearWater = false;
			if (px > 0 && terrain[i - 1] === TERRAIN_WATER) nearWater = true;
			if (px < width - 1 && terrain[i + 1] === TERRAIN_WATER)
				nearWater = true;
			if (py > 0 && terrain[i - width] === TERRAIN_WATER)
				nearWater = true;
			if (py < height - 1 && terrain[i + width] === TERRAIN_WATER)
				nearWater = true;

			if (nearWater) {
				activePumps++;
				visited[i] = 1;
				bfsQueue[tail] = i;
				tail++;
			}
		}
		if (building[i] !== BUILDING_EMPTY) totalDemand++;
	}

	aggregates[AGG.WATER_DEMAND] = totalDemand;

	// No pumps: everything has water (pre-plumbing era)
	if (!hasPumps) {
		for (let i = 0; i < size; i++) {
			waterCoverage[i] = 1;
		}
		aggregates[AGG.WATER_CAPACITY] = 0;
		return;
	}

	// Reset coverage
	for (let i = 0; i < size; i++) {
		waterCoverage[i] = 0;
	}

	aggregates[AGG.WATER_CAPACITY] = activePumps;

	// No active pumps (all placed pumps are away from water): nothing covered
	if (activePumps === 0) return;

	// BFS flood fill through conducting tiles
	let steps = 0;
	while (head < tail && steps < MAX_TILES) {
		steps++;
		const idx = bfsQueue[head] ?? 0;
		head++;
		waterCoverage[idx] = 1;

		const x = idx % width;
		const y = (idx - x) / width;

		if (x > 0) {
			const ni = idx - 1;
			if (visited[ni] !== 1 && conductsWater(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (x < width - 1) {
			const ni = idx + 1;
			if (visited[ni] !== 1 && conductsWater(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (y > 0) {
			const ni = idx - width;
			if (visited[ni] !== 1 && conductsWater(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (y < height - 1) {
			const ni = idx + width;
			if (visited[ni] !== 1 && conductsWater(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
	}
}
