/**
 * Civic coverage — compute per-tile service coverage from civic buildings.
 *
 * Police stations, fire stations, hospitals, schools, colleges, and libraries
 * each radiate coverage within CIVIC_COVERAGE_RADIUS[type]. Coverage is boolean
 * (0 or 1) per tile per service category. Parks and stadiums don't provide
 * "coverage" — their effect is a land-value bonus handled in land-value.ts.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	CIVIC_COLLEGE,
	CIVIC_COVERAGE_RADIUS,
	CIVIC_FIRE_STATION,
	CIVIC_HOSPITAL,
	CIVIC_LIBRARY,
	CIVIC_POLICE,
	CIVIC_SCHOOL,
} from "../constants.ts";

export function updateCivicCoverage(state: CityState): void {
	const {
		width,
		height,
		size,
		civic,
		policeCoverage,
		fireCoverage,
		educationCoverage,
		healthCoverage,
	} = state;

	// Reset all coverage layers
	policeCoverage.fill(0);
	fireCoverage.fill(0);
	educationCoverage.fill(0);
	healthCoverage.fill(0);

	let totalEducation = 0;
	let totalHealth = 0;
	let eduBuildings = 0;
	let healthBuildings = 0;

	for (let i = 0; i < size; i++) {
		const c = civic[i] ?? 0;
		if (c === 0) continue;

		const radius = CIVIC_COVERAGE_RADIUS[c] ?? 0;
		if (radius === 0) continue;

		const cx = i % width;
		const cy = (i - cx) / width;

		if (c === CIVIC_POLICE) {
			spreadCoverage(width, height, policeCoverage, cx, cy, radius);
		} else if (c === CIVIC_FIRE_STATION) {
			spreadCoverage(width, height, fireCoverage, cx, cy, radius);
		} else if (c === CIVIC_HOSPITAL) {
			spreadCoverage(width, height, healthCoverage, cx, cy, radius);
			healthBuildings++;
		} else if (
			c === CIVIC_SCHOOL ||
			c === CIVIC_COLLEGE ||
			c === CIVIC_LIBRARY
		) {
			spreadCoverage(width, height, educationCoverage, cx, cy, radius);
			eduBuildings++;
		}
	}

	// Compute aggregate coverage ratios (0..100)
	if (eduBuildings > 0) {
		for (let i = 0; i < size; i++) {
			totalEducation += educationCoverage[i] ?? 0;
		}
		state.aggregates[AGG.EDUCATION_LEVEL] = Math.min(
			100,
			(totalEducation / size) * 100,
		);
	} else {
		state.aggregates[AGG.EDUCATION_LEVEL] = 0;
	}

	if (healthBuildings > 0) {
		for (let i = 0; i < size; i++) {
			totalHealth += healthCoverage[i] ?? 0;
		}
		state.aggregates[AGG.HEALTH_LEVEL] = Math.min(
			100,
			(totalHealth / size) * 100,
		);
	} else {
		state.aggregates[AGG.HEALTH_LEVEL] = 0;
	}
}

function spreadCoverage(
	width: number,
	height: number,
	layer: Uint8Array,
	cx: number,
	cy: number,
	radius: number,
): void {
	for (let dy = -radius; dy <= radius; dy++) {
		const ny = cy + dy;
		if (ny < 0 || ny >= height) continue;
		const adx = radius - Math.abs(dy);
		for (let dx = -adx; dx <= adx; dx++) {
			const nx = cx + dx;
			if (nx < 0 || nx >= width) continue;
			layer[ny * width + nx] = 1;
		}
	}
}
