/**
 * Water system — radius-based coverage from water pumps.
 *
 * Water pumps must be adjacent to a water tile to function. Each active pump
 * covers all tiles within WATER_COVERAGE_RADIUS (Manhattan distance).
 *
 * Progressive disclosure: if no water pumps exist yet, all tiles are
 * considered covered so the early game works without infrastructure.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_WATER_PUMP,
	TERRAIN_WATER,
	WATER_COVERAGE_RADIUS,
} from "../constants.ts";

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

	// Check for any water pumps
	for (let i = 0; i < size; i++) {
		if (civic[i] === CIVIC_WATER_PUMP) hasPumps = true;
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

	// For each active pump, spread coverage
	for (let i = 0; i < size; i++) {
		if (civic[i] !== CIVIC_WATER_PUMP) continue;

		const px = i % width;
		const py = (i - px) / width;

		// Check adjacency to water (orthogonal)
		let nearWater = false;
		if (px > 0 && terrain[i - 1] === TERRAIN_WATER) nearWater = true;
		if (px < width - 1 && terrain[i + 1] === TERRAIN_WATER) nearWater = true;
		if (py > 0 && terrain[i - width] === TERRAIN_WATER) nearWater = true;
		if (py < height - 1 && terrain[i + width] === TERRAIN_WATER)
			nearWater = true;

		if (!nearWater) continue;
		activePumps++;

		// Cover tiles within Manhattan distance
		for (let dy = -WATER_COVERAGE_RADIUS; dy <= WATER_COVERAGE_RADIUS; dy++) {
			const ny = py + dy;
			if (ny < 0 || ny >= height) continue;
			const adx = WATER_COVERAGE_RADIUS - Math.abs(dy);
			for (let dx = -adx; dx <= adx; dx++) {
				const nx = px + dx;
				if (nx < 0 || nx >= width) continue;
				waterCoverage[ny * width + nx] = 1;
			}
		}
	}

	aggregates[AGG.WATER_CAPACITY] = activePumps;
}
