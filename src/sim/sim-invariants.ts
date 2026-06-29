/**
 * Simulation postcondition checks — run after each tick to catch model bugs.
 *
 * Guarded by `import.meta.env.DEV` so production builds pay zero cost.
 * Violations are collected (not thrown) so the sim keeps running and the
 * dev panel can display all problems at once.
 */

import type { CityState } from "./city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	BUILDING_HIGH,
	DENSITY_HIGH,
	MAX_DEMAND,
	MAX_POLLUTION,
	ZONE_NONE,
} from "./constants.ts";

// ---- Violation log ----------------------------------------------------------

export interface Violation {
	readonly system: string;
	readonly message: string;
	readonly tick: number;
}

const MAX_VIOLATIONS = 50;
const violations: Violation[] = [];

export function getViolations(): ReadonlyArray<Violation> {
	return violations;
}

export function clearViolations(): void {
	violations.length = 0;
}

function addViolation(system: string, message: string, tick: number): void {
	if (violations.length < MAX_VIOLATIONS) {
		violations.push({ system, message, tick });
	}
}

// ---- Check functions --------------------------------------------------------

export function checkAggregates(state: CityState): void {
	if (!import.meta.env.DEV) return;

	const agg = state.aggregates;
	const tick = Math.floor(agg[AGG.TICK] ?? 0);

	for (let i = 0; i < AGG.COUNT; i++) {
		const v = agg[i];
		if (v === undefined || Number.isNaN(v)) {
			addViolation("aggregates", `aggregates[${i}] is NaN`, tick);
		}
		if (v !== undefined && !Number.isFinite(v)) {
			addViolation("aggregates", `aggregates[${i}] is Infinity`, tick);
		}
	}

	const pop = agg[AGG.TOTAL_POP] ?? 0;
	if (pop < 0) {
		addViolation("aggregates", `TOTAL_POP is negative: ${pop}`, tick);
	}

	const cJobs = agg[AGG.TOTAL_C_JOBS] ?? 0;
	if (cJobs < 0) {
		addViolation("aggregates", `TOTAL_C_JOBS is negative: ${cJobs}`, tick);
	}

	const iJobs = agg[AGG.TOTAL_I_JOBS] ?? 0;
	if (iJobs < 0) {
		addViolation("aggregates", `TOTAL_I_JOBS is negative: ${iJobs}`, tick);
	}

	const rDemand = agg[AGG.R_DEMAND] ?? 0;
	if (Math.abs(rDemand) > MAX_DEMAND * 1.01) {
		addViolation("rciDemand", `R_DEMAND out of bounds: ${rDemand}`, tick);
	}

	const cDemand = agg[AGG.C_DEMAND] ?? 0;
	if (Math.abs(cDemand) > MAX_DEMAND * 1.01) {
		addViolation("rciDemand", `C_DEMAND out of bounds: ${cDemand}`, tick);
	}

	const iDemand = agg[AGG.I_DEMAND] ?? 0;
	if (Math.abs(iDemand) > MAX_DEMAND * 1.01) {
		addViolation("rciDemand", `I_DEMAND out of bounds: ${iDemand}`, tick);
	}

	const treasury = agg[AGG.TREASURY] ?? 0;
	if (Number.isNaN(treasury)) {
		addViolation("publicFinance", "TREASURY is NaN", tick);
	}
}

export function checkGridIntegrity(state: CityState): void {
	if (!import.meta.env.DEV) return;

	const { size, zoning, building, densityCap, population, jobs, pollution } =
		state;
	const tick = Math.floor(state.aggregates[AGG.TICK] ?? 0);

	for (let i = 0; i < size; i++) {
		const zone = zoning[i] ?? 0;
		const bld = building[i] ?? 0;

		// Building on unzoned land (roads/rail/powerlines/civic are fine)
		if (
			zone === ZONE_NONE &&
			bld !== BUILDING_EMPTY &&
			state.roads[i] !== 1 &&
			state.rail[i] !== 1 &&
			state.powerLines[i] !== 1 &&
			(state.civic[i] ?? 0) === 0
		) {
			addViolation("grid", `tile ${i}: building ${bld} on unzoned land`, tick);
		}

		// Building tier out of range
		if (bld > BUILDING_HIGH) {
			addViolation(
				"grid",
				`tile ${i}: building tier ${bld} out of range`,
				tick,
			);
		}

		// Building exceeds density cap (cap of 0 means unzoned, so skip)
		const cap = densityCap[i] ?? 0;
		if (cap > 0 && bld > cap) {
			addViolation(
				"grid",
				`tile ${i}: building ${bld} exceeds density cap ${cap}`,
				tick,
			);
		}

		// Density cap out of range
		if (cap > DENSITY_HIGH) {
			addViolation("grid", `tile ${i}: density cap ${cap} out of range`, tick);
		}

		// Pollution over max
		const pol = pollution[i] ?? 0;
		if (pol > MAX_POLLUTION) {
			addViolation(
				"externalities",
				`tile ${i}: pollution ${pol} > MAX_POLLUTION`,
				tick,
			);
		}

		// Empty building should have zero pop/jobs
		if (bld === BUILDING_EMPTY) {
			if ((population[i] ?? 0) > 0) {
				addViolation(
					"grid",
					`tile ${i}: population ${population[i]} on empty building`,
					tick,
				);
			}
			if ((jobs[i] ?? 0) > 0) {
				addViolation(
					"grid",
					`tile ${i}: jobs ${jobs[i]} on empty building`,
					tick,
				);
			}
		}
	}
}
