/**
 * Utility network — the shared bounded flood fill behind power and water
 * coverage.
 *
 * Both utilities answer the same question: starting from a set of source
 * tiles, which tiles can the network actually serve? The graph walk is a
 * multi-source breadth-first search, so tiles come out in order of network
 * distance from the nearest source — nearest first.
 *
 * That ordering is what makes capacity meaningful. Each tile the walk reaches
 * spends its demand out of the network's capacity, and the walk stops at the
 * first tile it can no longer afford. Supply therefore falls off with distance:
 * the districts nearest a plant or pump stay lit, and the outskirts are the
 * ones cut off. There is no citywide blackout — a shortfall costs you the edge
 * of the network, proportional to how short you are.
 *
 * Callers own their seed buffer and pre-fill it while they tally demand; this
 * module owns the queue and visited scratch. Neither allocates during a tick.
 */

import type { CityState } from "../city-state.ts";
import { MAX_GRID_SIZE } from "../constants.ts";

const MAX_TILES = MAX_GRID_SIZE * MAX_GRID_SIZE;

// Scratch shared by every utility network. Safe because coverage passes run
// sequentially within a tick and each pass reinitialises what it reads.
const bfsQueue = new Uint32Array(MAX_TILES);
const visited = new Uint8Array(MAX_TILES);

/**
 * Describes one kind of utility network. Built once at module load — never per
 * tick — so passing it costs nothing.
 */
export interface NetworkSpec {
	/**
	 * Whether the utility can cross tile `idx`. Implementations are expected to
	 * reject water terrain themselves.
	 */
	readonly conducts: (state: CityState, idx: number) => boolean;
	/** Units tile `idx` draws from the network. 0 for conduits and empty land. */
	readonly demandAt: (state: CityState, idx: number) => number;
}

/**
 * Flood `coverage` outward from `seeds`, serving tiles nearest-first until
 * `capacity` runs out.
 *
 * `coverage` is fully reset to 0 first, so a caller never needs its own clear
 * pass. Seed tiles are always reached, whether or not they conduct — a plant or
 * pump is a source, not a conduit.
 *
 * Returns the demand actually served, which is <= `capacity` and <= the
 * network's total demand.
 *
 * The walk is bounded by MAX_TILES: every tile enters the queue at most once
 * because `visited` is set at enqueue time, never at dequeue time.
 */
export function floodCoverage(
	state: CityState,
	seeds: Uint32Array,
	seedCount: number,
	spec: NetworkSpec,
	capacity: number,
	coverage: Uint8Array,
): number {
	const { width, height, size } = state;

	for (let i = 0; i < size; i++) {
		visited[i] = 0;
		coverage[i] = 0;
	}

	let head = 0;
	let tail = 0;
	for (let s = 0; s < seedCount; s++) {
		const idx = seeds[s] ?? 0;
		if (visited[idx] === 1) continue;
		visited[idx] = 1;
		bfsQueue[tail] = idx;
		tail++;
	}

	let remaining = capacity;
	let steps = 0;
	while (head < tail && steps < MAX_TILES) {
		steps++;
		const idx = bfsQueue[head] ?? 0;
		head++;

		// The supply frontier. Stopping here rather than skipping this one tile
		// and carrying on keeps the served region contiguous: a player reading
		// the overlay sees one shrinking blob, not a scatter of served tiles
		// among starved neighbours.
		const demand = spec.demandAt(state, idx);
		if (demand > remaining) break;
		remaining -= demand;
		coverage[idx] = 1;

		const x = idx % width;
		const y = (idx - x) / width;

		if (x > 0) {
			const ni = idx - 1;
			if (visited[ni] !== 1 && spec.conducts(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (x < width - 1) {
			const ni = idx + 1;
			if (visited[ni] !== 1 && spec.conducts(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (y > 0) {
			const ni = idx - width;
			if (visited[ni] !== 1 && spec.conducts(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
		if (y < height - 1) {
			const ni = idx + width;
			if (visited[ni] !== 1 && spec.conducts(state, ni)) {
				visited[ni] = 1;
				bfsQueue[tail] = ni;
				tail++;
			}
		}
	}

	return capacity - remaining;
}

/** Zero every tile of `coverage` — the outcome of a dead or sourceless grid. */
export function clearCoverage(coverage: Uint8Array, size: number): void {
	for (let i = 0; i < size; i++) {
		coverage[i] = 0;
	}
}
