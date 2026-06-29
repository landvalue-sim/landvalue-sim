/**
 * Scenarios — deterministic, pre-built city layouts for testing and demos.
 *
 * `buildTestCity` writes a small mixed-use downtown directly into the city
 * state: a road grid, a commercial core, a residential ring, and industry in
 * the corners. It is engine-agnostic and deterministic (no RNG), so it can be
 * triggered from a debug button and produces the same city every time.
 */

import { type CityState, inBounds, tileIndex } from "./city-state.ts";
import {
	AGG,
	BUILDING_HIGH,
	BUILDING_LOW,
	BUILDING_MED,
	JOBS_C_PER_DENSITY,
	JOBS_I_PER_DENSITY,
	POP_PER_DENSITY,
	STARTING_TREASURY,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";

const BLOCKS = 6; // blocks per axis
const BLOCK = 3; // tiles per block edge
const STRIDE = BLOCK + 1; // block edge + the 1-tile road between blocks
const SPAN = BLOCKS * STRIDE + 1; // total core footprint (roads on both edges)

// Block plan, row-major (top -> bottom). Each char is a zone + density:
//   X downtown commercial (high)   C commercial (med)
//   R residential (med)            r residential (low)
//   I industrial (low)             . empty
const PLAN = [
	"rrRRrr",
	"rRCCRr",
	"RCXXCR",
	"RCXXCR",
	"rRCCRr",
	"IIrrII",
] as const;

interface ZoneSpec {
	readonly zone: number;
	readonly tier: number;
}

function specForChar(c: string): ZoneSpec | null {
	switch (c) {
		case "X":
			return { zone: ZONE_COMMERCIAL, tier: BUILDING_HIGH };
		case "C":
			return { zone: ZONE_COMMERCIAL, tier: BUILDING_MED };
		case "R":
			return { zone: ZONE_RESIDENTIAL, tier: BUILDING_MED };
		case "r":
			return { zone: ZONE_RESIDENTIAL, tier: BUILDING_LOW };
		case "I":
			return { zone: ZONE_INDUSTRIAL, tier: BUILDING_LOW };
		default:
			return null;
	}
}

/** Replace the current city with a deterministic pre-built downtown. */
export function buildTestCity(state: CityState): void {
	resetCity(state);

	const x0 = Math.max(0, Math.floor((state.width - SPAN) / 2));
	const y0 = Math.max(0, Math.floor((state.height - SPAN) / 2));

	layRoads(state, x0, y0);
	layBlocks(state, x0, y0);
}

function resetCity(state: CityState): void {
	state.roads.fill(0);
	state.zoning.fill(0);
	state.building.fill(0);
	state.population.fill(0);
	state.jobs.fill(0);
	state.pollution.fill(0);
	state.traffic.fill(0);
	state.landValue.fill(0);

	state.aggregates[AGG.TICK] = 0;
	state.aggregates[AGG.TREASURY] = STARTING_TREASURY;
	state.aggregates[AGG.R_DEMAND] = 0;
	state.aggregates[AGG.C_DEMAND] = 0;
	state.aggregates[AGG.I_DEMAND] = 0;
}

function layRoads(state: CityState, x0: number, y0: number): void {
	for (let k = 0; k <= BLOCKS; k++) {
		const rx = x0 + k * STRIDE;
		const ry = y0 + k * STRIDE;
		for (let i = 0; i < SPAN; i++) {
			setRoad(state, rx, y0 + i);
			setRoad(state, x0 + i, ry);
		}
	}
}

function layBlocks(state: CityState, x0: number, y0: number): void {
	for (let by = 0; by < BLOCKS; by++) {
		const row = PLAN[by];
		if (row === undefined) continue;
		for (let bx = 0; bx < BLOCKS; bx++) {
			const spec = specForChar(row[bx] ?? ".");
			if (spec === null) continue;
			const bx0 = x0 + bx * STRIDE + 1;
			const by0 = y0 + by * STRIDE + 1;
			for (let dy = 0; dy < BLOCK; dy++) {
				for (let dx = 0; dx < BLOCK; dx++) {
					fillTile(state, bx0 + dx, by0 + dy, spec);
				}
			}
		}
	}
}

function setRoad(state: CityState, x: number, y: number): void {
	if (!inBounds(state.width, state.height, x, y)) return;
	const idx = tileIndex(state.width, x, y);
	state.roads[idx] = 1;
	state.zoning[idx] = ZONE_NONE;
	state.building[idx] = 0;
}

function fillTile(
	state: CityState,
	x: number,
	y: number,
	spec: ZoneSpec,
): void {
	if (!inBounds(state.width, state.height, x, y)) return;
	const idx = tileIndex(state.width, x, y);
	if (state.roads[idx] === 1) return; // never overwrite a road

	state.zoning[idx] = spec.zone;
	state.building[idx] = spec.tier;

	if (spec.zone === ZONE_RESIDENTIAL) {
		state.population[idx] = POP_PER_DENSITY[spec.tier] ?? 0;
		state.jobs[idx] = 0;
	} else if (spec.zone === ZONE_COMMERCIAL) {
		state.jobs[idx] = JOBS_C_PER_DENSITY[spec.tier] ?? 0;
		state.population[idx] = 0;
	} else if (spec.zone === ZONE_INDUSTRIAL) {
		state.jobs[idx] = JOBS_I_PER_DENSITY[spec.tier] ?? 0;
		state.population[idx] = 0;
	}
}
