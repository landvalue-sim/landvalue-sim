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
	// The unemployment term is the same for every tile — hoist it.
	const unemploymentCrime = Math.floor(
		unemployment * CRIME_UNEMPLOYMENT_FACTOR * 100,
	);

	// Hoisted imported constants: under Vite's dev/test module transform an
	// imported binding is a namespace property read on every use, which is
	// ruinous inside per-tile loops. Locals compile to registers everywhere.
	const zoneNone = ZONE_NONE;
	const empty = BUILDING_EMPTY;
	const crimeBase = CRIME_BASE;
	const densityFactor = CRIME_DENSITY_FACTOR;
	const lowValueThreshold = CRIME_LOW_VALUE_THRESHOLD;
	const lowValueBonus = CRIME_LOW_VALUE_BONUS;
	const policeFactor = 1 - CRIME_POLICE_SUPPRESSION;
	const maxCrime = MAX_CRIME;

	let totalCrime = 0;

	for (let i = 0; i < size; i++) {
		const zone = zoning[i] ?? 0;
		if (zone === zoneNone || building[i] === empty) {
			crime[i] = 0;
			continue;
		}

		const bld = building[i] ?? 0;
		const lv = landValue[i] ?? 0;

		let c = crimeBase;

		// Higher density = more crime
		c += bld * densityFactor;

		// Low land value areas attract crime
		if (lv < lowValueThreshold) {
			c += lowValueBonus;
		}

		// Unemployment drives crime
		c += unemploymentCrime;

		// Police coverage suppresses crime
		if (policeCoverage[i] === 1) {
			c = Math.floor(c * policeFactor);
		}

		const clamped = c > maxCrime ? maxCrime : c > 0 ? c : 0;
		crime[i] = clamped;
		totalCrime += clamped;
	}

	aggregates[AGG.TOTAL_CRIME] = totalCrime;
}
