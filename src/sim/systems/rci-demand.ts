/**
 * RCI demand — the core economic feedback loop.
 *
 * Calculates demand pressure for Residential, Commercial, and Industrial
 * zones based on current population, jobs, tax rates, and externalities.
 *
 * The feedback loop:
 *   I base demand → I builds → jobs → R demand → R builds → population
 *   → C demand → C builds → more jobs → more R demand → growth spiral
 *   → equilibrium when supply meets demand.
 *
 * Demand values range from -MAX_DEMAND to +MAX_DEMAND.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	COMMERCIAL_PER_POP,
	INDUSTRIAL_BASE_DEMAND,
	INDUSTRIAL_PER_POP,
	JOBS_C_PER_DENSITY,
	JOBS_I_PER_DENSITY,
	MAX_DEMAND,
	POP_PER_DENSITY,
	RESIDENTS_PER_JOB,
	TAX_DEMAND_PENALTY,
	TAX_NEUTRAL_RATE,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

export function updateRciDemand(state: CityState): void {
	const { size, zoning, building, population, jobs, pollution, aggregates } =
		state;

	// --- Tally current supply ------------------------------------------------
	let totalPop = 0;
	let totalCJobs = 0;
	let totalIJobs = 0;
	let occupiedC = 0;
	let occupiedI = 0;
	let pollutionOnR = 0;
	let rTileCount = 0;

	for (let i = 0; i < size; i++) {
		const zone = zoning[i];
		const bld = building[i];

		if (zone === ZONE_RESIDENTIAL) {
			rTileCount++;
			pollutionOnR += pollution[i] ?? 0;
			if (bld !== undefined && bld !== BUILDING_EMPTY) {
				const pop = POP_PER_DENSITY[bld];
				if (pop !== undefined) {
					totalPop += pop;
					population[i] = pop;
				}
			}
		} else if (zone === ZONE_COMMERCIAL) {
			if (bld !== undefined && bld !== BUILDING_EMPTY) {
				occupiedC++;
				const j = JOBS_C_PER_DENSITY[bld];
				if (j !== undefined) {
					totalCJobs += j;
					jobs[i] = j;
				}
			}
		} else if (zone === ZONE_INDUSTRIAL) {
			if (bld !== undefined && bld !== BUILDING_EMPTY) {
				occupiedI++;
				const j = JOBS_I_PER_DENSITY[bld];
				if (j !== undefined) {
					totalIJobs += j;
					jobs[i] = j;
				}
			}
		}
	}

	const totalJobs = totalCJobs + totalIJobs;

	// Store totals
	aggregates[AGG.TOTAL_POP] = totalPop;
	aggregates[AGG.TOTAL_C_JOBS] = totalCJobs;
	aggregates[AGG.TOTAL_I_JOBS] = totalIJobs;

	// --- Tax penalties -------------------------------------------------------
	const taxR = aggregates[AGG.TAX_RATE_R] ?? TAX_NEUTRAL_RATE;
	const taxC = aggregates[AGG.TAX_RATE_C] ?? TAX_NEUTRAL_RATE;
	const taxI = aggregates[AGG.TAX_RATE_I] ?? TAX_NEUTRAL_RATE;

	const rTaxPenalty = Math.max(0, taxR - TAX_NEUTRAL_RATE) * TAX_DEMAND_PENALTY;
	const cTaxPenalty = Math.max(0, taxC - TAX_NEUTRAL_RATE) * TAX_DEMAND_PENALTY;
	const iTaxPenalty = Math.max(0, taxI - TAX_NEUTRAL_RATE) * TAX_DEMAND_PENALTY;

	// --- Pollution penalty on R ----------------------------------------------
	const avgPollutionOnR = rTileCount > 0 ? pollutionOnR / rTileCount : 0;
	const rPollutionPenalty = avgPollutionOnR * 0.5;

	// --- Demand targets ------------------------------------------------------
	// R: people want to live where there are jobs
	const targetPop = totalJobs * RESIDENTS_PER_JOB;
	const rGap = targetPop - totalPop;

	// C: commercial demand driven by population
	const targetC = totalPop * COMMERCIAL_PER_POP;
	const cGap = targetC - occupiedC;

	// I: base external demand + population-driven
	const targetI = INDUSTRIAL_BASE_DEMAND + totalPop * INDUSTRIAL_PER_POP;
	const iGap = targetI - occupiedI;

	// --- Smooth demand adjustment --------------------------------------------
	const prevR = aggregates[AGG.R_DEMAND] ?? 0;
	const prevC = aggregates[AGG.C_DEMAND] ?? 0;
	const prevI = aggregates[AGG.I_DEMAND] ?? 0;

	// Raw target demand
	const rawR = rGap * 2.0 - rTaxPenalty - rPollutionPenalty;
	const rawC = cGap * 15.0 - cTaxPenalty;
	const rawI = iGap * 8.0 - iTaxPenalty;

	// Lerp toward target
	const SMOOTHING = 0.15;
	const newR = prevR + (rawR - prevR) * SMOOTHING;
	const newC = prevC + (rawC - prevC) * SMOOTHING;
	const newI = prevI + (rawI - prevI) * SMOOTHING;

	aggregates[AGG.R_DEMAND] = clamp(newR, -MAX_DEMAND, MAX_DEMAND);
	aggregates[AGG.C_DEMAND] = clamp(newC, -MAX_DEMAND, MAX_DEMAND);
	aggregates[AGG.I_DEMAND] = clamp(newI, -MAX_DEMAND, MAX_DEMAND);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
