/**
 * Fire system — fire risk, ignition, spread, and containment.
 *
 * Fire risk is higher near industrial zones, in dense areas, and with low fire
 * coverage. Each tick, tiles may ignite based on risk (checked via seeded PRNG).
 * Active fires spread to adjacent flammable tiles and are contained over time
 * (faster with fire station coverage). Fire destroys buildings.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	FIRE_BASE_RISK,
	FIRE_CONTAINMENT_CHANCE,
	FIRE_COVERED_CONTAINMENT_BONUS,
	FIRE_COVERAGE_SUPPRESSION,
	FIRE_DENSITY_RISK,
	FIRE_IGNITION_DIVISOR,
	FIRE_INDUSTRIAL_RISK,
	FIRE_SPREAD_CHANCE,
	MAX_FIRE_CHECKS_PER_TICK,
	TERRAIN_WATER,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
} from "../constants.ts";
import { nextU32 } from "../prng.ts";

export function updateFire(state: CityState): void {
	const {
		width,
		height,
		size,
		terrain,
		zoning,
		building,
		fireCoverage,
		fire,
		rng,
	} = state;

	let fireCount = 0;

	// --- Phase 1: Containment and spread of existing fires ---
	// Process existing fires first. Use a scan with bounded checks.
	for (let i = 0; i < size; i++) {
		if (fire[i] !== 1) continue;

		// Try containment
		const containChance =
			FIRE_CONTAINMENT_CHANCE +
			(fireCoverage[i] === 1 ? FIRE_COVERED_CONTAINMENT_BONUS : 0);
		const roll = nextU32(rng) % 100;
		if (roll < containChance) {
			// Fire contained — destroy the building
			fire[i] = 0;
			building[i] = BUILDING_EMPTY;
			state.population[i] = 0;
			state.jobs[i] = 0;
			continue;
		}

		fireCount++;

		// Try spreading to orthogonal neighbors
		const x = i % width;
		const y = (i - x) / width;
		const neighbors = [
			x > 0 ? i - 1 : -1,
			x < width - 1 ? i + 1 : -1,
			y > 0 ? i - width : -1,
			y < height - 1 ? i + width : -1,
		];

		for (let n = 0; n < 4; n++) {
			const ni = neighbors[n] ?? -1;
			if (ni < 0) continue;
			if (fire[ni] === 1) continue;
			if (terrain[ni] === TERRAIN_WATER) continue;
			if (building[ni] === BUILDING_EMPTY) continue;

			const spreadRoll = nextU32(rng) % 100;
			let spreadChance = FIRE_SPREAD_CHANCE;
			if (fireCoverage[ni] === 1) {
				spreadChance = Math.floor(
					spreadChance * (1 - FIRE_COVERAGE_SUPPRESSION),
				);
			}
			if (spreadRoll < spreadChance) {
				fire[ni] = 1;
			}
		}
	}

	// --- Phase 2: New ignitions ---
	// Check a bounded number of tiles for new fire starts per tick.
	// Deterministic selection via PRNG.
	for (let check = 0; check < MAX_FIRE_CHECKS_PER_TICK; check++) {
		const idx = nextU32(rng) % size;

		if (fire[idx] === 1) continue;
		if (terrain[idx] === TERRAIN_WATER) continue;
		if (building[idx] === BUILDING_EMPTY) continue;

		const zone = zoning[idx] ?? 0;
		if (zone === ZONE_NONE) continue;

		let risk = FIRE_BASE_RISK;
		if (zone === ZONE_INDUSTRIAL) risk += FIRE_INDUSTRIAL_RISK;
		risk += (building[idx] ?? 0) * FIRE_DENSITY_RISK;

		if (fireCoverage[idx] === 1) {
			risk = Math.floor(risk * (1 - FIRE_COVERAGE_SUPPRESSION));
		}

		const roll = nextU32(rng) % FIRE_IGNITION_DIVISOR;
		if (roll < risk) {
			fire[idx] = 1;
			fireCount++;
		}
	}

	state.aggregates[AGG.FIRE_COUNT] = fireCount;
}
