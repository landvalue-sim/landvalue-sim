/**
 * Externalities — pollution spread from industrial zones.
 *
 * First pass MVP: industrial tiles emit pollution that decays with distance.
 * Crime and traffic are left at zero for now (stubs for future systems).
 */

import { type CityState, inBounds } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	MAX_POLLUTION,
	POLLUTION_DECAY,
	POLLUTION_PER_INDUSTRIAL,
	POLLUTION_SPREAD_RADIUS,
	ZONE_INDUSTRIAL,
} from "../constants.ts";

export function updateExternalities(state: CityState): void {
	const { width, height, size, zoning, building, pollution } = state;

	// Reset pollution field
	pollution.fill(0);

	// For each occupied industrial tile, spread pollution
	for (let i = 0; i < size; i++) {
		if (zoning[i] !== ZONE_INDUSTRIAL || building[i] === BUILDING_EMPTY) {
			continue;
		}

		const cx = i % width;
		const cy = (i - cx) / width;

		// Spread pollution in a square radius
		for (
			let dy = -POLLUTION_SPREAD_RADIUS;
			dy <= POLLUTION_SPREAD_RADIUS;
			dy++
		) {
			for (
				let dx = -POLLUTION_SPREAD_RADIUS;
				dx <= POLLUTION_SPREAD_RADIUS;
				dx++
			) {
				const nx = cx + dx;
				const ny = cy + dy;

				if (!inBounds(width, height, nx, ny)) continue;

				const dist = Math.abs(dx) + Math.abs(dy); // Manhattan distance
				if (dist === 0) {
					// Source tile
					const ni = ny * width + nx;
					const current = pollution[ni] ?? 0;
					pollution[ni] = Math.min(
						MAX_POLLUTION,
						current + POLLUTION_PER_INDUSTRIAL,
					);
				} else {
					const decay = POLLUTION_DECAY ** dist;
					const amount = Math.floor(POLLUTION_PER_INDUSTRIAL * decay);
					if (amount > 0) {
						const ni = ny * width + nx;
						const current = pollution[ni] ?? 0;
						pollution[ni] = Math.min(MAX_POLLUTION, current + amount);
					}
				}
			}
		}
	}
}
