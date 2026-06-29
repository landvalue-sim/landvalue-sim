/**
 * Crime system — compute per-tile crime driven by density, land value,
 * unemployment, and police coverage.
 *
 * Crime lowers R/C land value (handled in land-value.ts) and can drive
 * abandonment at high levels.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CRIME_BASE,
	CRIME_DENSITY_FACTOR,
	CRIME_LOW_VALUE_BONUS,
	CRIME_LOW_VALUE_THRESHOLD,
	CRIME_POLICE_SUPPRESSION,
	CRIME_UNEMPLOYMENT_FACTOR,
	MAX_CRIME,
	ZONE_NONE,
} from "../constants.ts";

export function updateCrime(state: CityState): void {
	const {
		size,
		zoning,
		building,
		landValue,
		policeCoverage,
		crime,
		aggregates,
	} = state;

	const totalPop = aggregates[AGG.TOTAL_POP] ?? 0;
	const totalJobs =
		(aggregates[AGG.TOTAL_C_JOBS] ?? 0) + (aggregates[AGG.TOTAL_I_JOBS] ?? 0);
	// Unemployment ratio: 0 when full employment, rises when pop > jobs * 2.5
	const unemployment =
		totalPop > 0 ? Math.max(0, 1 - (totalJobs * 2.5) / totalPop) : 0;

	let totalCrime = 0;

	for (let i = 0; i < size; i++) {
		const zone = zoning[i] ?? 0;
		if (zone === ZONE_NONE || building[i] === BUILDING_EMPTY) {
			crime[i] = 0;
			continue;
		}

		const bld = building[i] ?? 0;
		const lv = landValue[i] ?? 0;

		let c = CRIME_BASE;

		// Higher density = more crime
		c += bld * CRIME_DENSITY_FACTOR;

		// Low land value areas attract crime
		if (lv < CRIME_LOW_VALUE_THRESHOLD) {
			c += CRIME_LOW_VALUE_BONUS;
		}

		// Unemployment drives crime
		c += Math.floor(unemployment * CRIME_UNEMPLOYMENT_FACTOR * 100);

		// Police coverage suppresses crime
		if (policeCoverage[i] === 1) {
			c = Math.floor(c * (1 - CRIME_POLICE_SUPPRESSION));
		}

		const clamped = Math.min(MAX_CRIME, Math.max(0, c));
		crime[i] = clamped;
		totalCrime += clamped;
	}

	aggregates[AGG.TOTAL_CRIME] = totalCrime;
}
