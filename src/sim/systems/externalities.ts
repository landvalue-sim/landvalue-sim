/**
 * Externalities — pollution spread from industrial zones and power plants.
 *
 * Industrial tiles emit pollution that decays with distance. Coal power
 * plants also emit pollution. Traffic contributes additional pollution
 * scaled by TRAFFIC_POLLUTION_FACTOR.
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

// Pollution decay per Manhattan distance, precomputed from the exact
// expression the spread loop used (POLLUTION_DECAY ** dist).
const DECAY_POW = new Float64Array(2 * POLLUTION_SPREAD_RADIUS + 1);
for (let d = 0; d < DECAY_POW.length; d++) {
	DECAY_POW[d] = POLLUTION_DECAY ** d;
}

export function updateExternalities(state: CityState): void {
	const { width, height, size, zoning, building, civic, traffic, pollution } =
		state;
	// Hoisted imported constants: under Vite's dev/test module transform an
	// imported binding is a namespace property read on every use, which is
	// ruinous inside per-tile loops. Locals compile to registers everywhere.
	const zoneI = ZONE_INDUSTRIAL;
	const empty = BUILDING_EMPTY;
	const industrialAmount = POLLUTION_PER_INDUSTRIAL;
	const plantPollution = POWER_PLANT_POLLUTION;
	const trafficFactor = TRAFFIC_POLLUTION_FACTOR;
	const cap = MAX_POLLUTION;

	// Reset pollution field
	pollution.fill(0);

	// For each occupied industrial tile, spread pollution
	for (let i = 0; i < size; i++) {
		if (zoning[i] === zoneI && building[i] !== empty) {
			spreadPollution(width, height, pollution, i, industrialAmount);
		}
	}

	// For each polluting civic building (e.g. coal plant), spread pollution
	for (let i = 0; i < size; i++) {
		const c = civic[i] ?? 0;
		const polAmount = plantPollution[c];
		if (polAmount !== undefined && polAmount > 0) {
			spreadPollution(width, height, pollution, i, polAmount);
		}
	}

	// Traffic contributes to pollution on road tiles
	for (let i = 0; i < size; i++) {
		const t = traffic[i] ?? 0;
		if (t > 0) {
			const trafficPol = Math.floor(t * trafficFactor);
			if (trafficPol > 0) {
				const current = pollution[i] ?? 0;
				pollution[i] = current + trafficPol > cap ? cap : current + trafficPol;
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
	// Hoisted imported constants — see updateExternalities.
	const radius = POLLUTION_SPREAD_RADIUS;
	const cap = MAX_POLLUTION;

	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			const nx = cx + dx;
			const ny = cy + dy;

			if (!inBounds(width, height, nx, ny)) continue;

			const dist = Math.abs(dx) + Math.abs(dy);
			const ni = ny * width + nx;

			if (dist === 0) {
				const current = pollution[ni] ?? 0;
				pollution[ni] = current + amount > cap ? cap : current + amount;
			} else {
				const spread = Math.floor(amount * (DECAY_POW[dist] ?? 0));
				if (spread > 0) {
					const current = pollution[ni] ?? 0;
					pollution[ni] = current + spread > cap ? cap : current + spread;
				}
			}
		}
	}
}
