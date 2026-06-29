/**
 * Externalities — pollution spread from industrial zones and power plants.
 *
 * Industrial tiles emit pollution that decays with distance. Coal power
 * plants also emit pollution. Crime and traffic are left at zero for now
 * (stubs for future systems).
 */

import { type CityState, inBounds } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	MAX_POLLUTION,
	POLLUTION_DECAY,
	POLLUTION_PER_INDUSTRIAL,
	POLLUTION_SPREAD_RADIUS,
	POWER_PLANT_POLLUTION,
	TRAFFIC_POLLUTION_FACTOR,
	ZONE_INDUSTRIAL,
} from "../constants.ts";

export function updateExternalities(state: CityState): void {
	const { width, height, size, zoning, building, civic, traffic, pollution } =
		state;

	// Reset pollution field
	pollution.fill(0);

	// For each occupied industrial tile, spread pollution
	for (let i = 0; i < size; i++) {
		if (zoning[i] === ZONE_INDUSTRIAL && building[i] !== BUILDING_EMPTY) {
			spreadPollution(width, height, pollution, i, POLLUTION_PER_INDUSTRIAL);
		}
	}

	// For each polluting civic building (e.g. coal plant), spread pollution
	for (let i = 0; i < size; i++) {
		const c = civic[i] ?? 0;
		const polAmount = POWER_PLANT_POLLUTION[c];
		if (polAmount !== undefined && polAmount > 0) {
			spreadPollution(width, height, pollution, i, polAmount);
		}
	}

	// Traffic contributes to pollution on road tiles
	for (let i = 0; i < size; i++) {
		const t = traffic[i] ?? 0;
		if (t > 0) {
			const trafficPol = Math.floor(t * TRAFFIC_POLLUTION_FACTOR);
			if (trafficPol > 0) {
				const current = pollution[i] ?? 0;
				pollution[i] = Math.min(MAX_POLLUTION, current + trafficPol);
			}
		}
	}
}

function spreadPollution(
	width: number,
	height: number,
	pollution: Uint8Array,
	sourceIdx: number,
	amount: number,
): void {
	const cx = sourceIdx % width;
	const cy = (sourceIdx - cx) / width;

	for (let dy = -POLLUTION_SPREAD_RADIUS; dy <= POLLUTION_SPREAD_RADIUS; dy++) {
		for (
			let dx = -POLLUTION_SPREAD_RADIUS;
			dx <= POLLUTION_SPREAD_RADIUS;
			dx++
		) {
			const nx = cx + dx;
			const ny = cy + dy;

			if (!inBounds(width, height, nx, ny)) continue;

			const dist = Math.abs(dx) + Math.abs(dy);
			const ni = ny * width + nx;

			if (dist === 0) {
				const current = pollution[ni] ?? 0;
				pollution[ni] = Math.min(MAX_POLLUTION, current + amount);
			} else {
				const decay = POLLUTION_DECAY ** dist;
				const spread = Math.floor(amount * decay);
				if (spread > 0) {
					const current = pollution[ni] ?? 0;
					pollution[ni] = Math.min(MAX_POLLUTION, current + spread);
				}
			}
		}
	}
}
