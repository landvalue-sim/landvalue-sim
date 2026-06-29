/**
 * Neighbor connections — detect road/rail at map edges and provide demand bonuses.
 *
 * Each edge tile with a road or rail counts as a connection. Connections boost
 * I and C demand (external trade and shoppers), tracked in AGG.
 */

import type { CityState } from "../city-state.ts";
import { AGG } from "../constants.ts";

export function updateConnections(state: CityState): void {
	const { width, height, roads, rail, aggregates } = state;

	let connections = 0;

	// Top and bottom edges
	for (let x = 0; x < width; x++) {
		const topIdx = x;
		const botIdx = (height - 1) * width + x;
		if (roads[topIdx] === 1 || rail[topIdx] === 1) connections++;
		if (roads[botIdx] === 1 || rail[botIdx] === 1) connections++;
	}

	// Left and right edges (skip corners already counted)
	for (let y = 1; y < height - 1; y++) {
		const leftIdx = y * width;
		const rightIdx = y * width + width - 1;
		if (roads[leftIdx] === 1 || rail[leftIdx] === 1) connections++;
		if (roads[rightIdx] === 1 || rail[rightIdx] === 1) connections++;
	}

	aggregates[AGG.CONNECTION_COUNT] = connections;
}
