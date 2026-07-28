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
	CIVIC_COAL_PLANT,
	CIVIC_FIRE_STATION,
	CIVIC_HOSPITAL,
	CIVIC_PARK,
	CIVIC_POLICE,
	CIVIC_SCHOOL,
	CIVIC_STADIUM,
	CIVIC_WATER_PUMP,
	DENSITY_HIGH,
	DENSITY_LOW,
	DENSITY_MED,
	JOBS_C_PER_DENSITY,
	JOBS_I_PER_DENSITY,
	POP_PER_DENSITY,
	STARTING_TREASURY,
	TERRAIN_LAND,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
import { generateTerrain } from "./terrain-gen.ts";

// Fixed seed for the demo's terrain so the test city is fully deterministic.
const TEST_CITY_TERRAIN_SEED = 20240;

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
	readonly density: number;
}

function specForChar(c: string): ZoneSpec | null {
	switch (c) {
		case "X":
			return {
				zone: ZONE_COMMERCIAL,
				tier: BUILDING_HIGH,
				density: DENSITY_HIGH,
			};
		case "C":
			return {
				zone: ZONE_COMMERCIAL,
				tier: BUILDING_MED,
				density: DENSITY_MED,
			};
		case "R":
			return {
				zone: ZONE_RESIDENTIAL,
				tier: BUILDING_MED,
				density: DENSITY_MED,
			};
		case "r":
			return {
				zone: ZONE_RESIDENTIAL,
				tier: BUILDING_LOW,
				density: DENSITY_LOW,
			};
		case "I":
			return {
				zone: ZONE_INDUSTRIAL,
				tier: BUILDING_LOW,
				density: DENSITY_LOW,
			};
		default:
			return null;
	}
}

// Dense city: every 4th row/column is road; the 3x3 blocks between are fully
// built out at high density, block columns cycling commercial/residential/
// industrial. Every DENSE_CELL-sized cell also gets a civic kit (coal plant,
// pond + water pump, police, fire, hospital, school, park) and every
// DENSE_RAIL_STRIDE-th road row carries rail, so no system idles.
const DENSE_STRIDE = 4;
const DENSE_CELL = 16;
const DENSE_RAIL_STRIDE = 16;

/** Overwrite a parcel with a civic building (mirrors placePowerPlant). */
function stampCivic(
	state: CityState,
	x: number,
	y: number,
	kind: number,
): void {
	if (!inBounds(state.width, state.height, x, y)) return;
	const idx = tileIndex(state.width, x, y);
	state.civic[idx] = kind;
	state.roads[idx] = 0;
	state.zoning[idx] = ZONE_NONE;
	state.densityCap[idx] = 0;
	state.building[idx] = 0;
	state.population[idx] = 0;
	state.jobs[idx] = 0;
}

/** Overwrite a parcel with water so an adjacent pump can activate. */
function stampPond(state: CityState, x: number, y: number): void {
	if (!inBounds(state.width, state.height, x, y)) return;
	const idx = tileIndex(state.width, x, y);
	state.terrain[idx] = TERRAIN_WATER;
	state.roads[idx] = 0;
	state.zoning[idx] = ZONE_NONE;
	state.densityCap[idx] = 0;
	state.building[idx] = 0;
	state.population[idx] = 0;
	state.jobs[idx] = 0;
}

/**
 * Replace the current city with a worst-case dense grid that fills the whole
 * map: a 4-stride road lattice with every block built out at high density.
 * This is the benchmark city for the per-tick budget (issue #11) — maximum
 * occupied R tiles, maximum commute pairs, industrial pollution sources,
 * rail, and a civic kit per 16x16 cell so power, water, civic coverage, and
 * externalities all do representative work rather than idling. Power and
 * water capacity intentionally fall short of full demand (a fully powered
 * build-out would need ~1500 coal plants under the current flat demand
 * tiers); the flood fills still walk the grid until capacity runs out.
 * Fully deterministic and terrain-flat so timings measure the systems.
 */
export function buildDenseCity(state: CityState): void {
	resetCity(state);

	const specs: readonly ZoneSpec[] = [
		{ zone: ZONE_COMMERCIAL, tier: BUILDING_HIGH, density: DENSITY_HIGH },
		{ zone: ZONE_RESIDENTIAL, tier: BUILDING_HIGH, density: DENSITY_HIGH },
		{ zone: ZONE_INDUSTRIAL, tier: BUILDING_HIGH, density: DENSITY_HIGH },
	];

	for (let y = 0; y < state.height; y++) {
		for (let x = 0; x < state.width; x++) {
			if (x % DENSE_STRIDE === 0 || y % DENSE_STRIDE === 0) {
				setRoad(state, x, y);
				if (y % DENSE_RAIL_STRIDE === 0) {
					state.rail[tileIndex(state.width, x, y)] = 1;
				}
				continue;
			}
			const spec = specs[Math.floor(x / DENSE_STRIDE) % 3];
			if (spec !== undefined) fillTile(state, x, y, spec);
		}
	}

	// One civic kit per cell, on block-interior offsets (never a road tile).
	for (let cy = 0; cy + DENSE_CELL <= state.height; cy += DENSE_CELL) {
		for (let cx = 0; cx + DENSE_CELL <= state.width; cx += DENSE_CELL) {
			stampCivic(state, cx + 2, cy + 2, CIVIC_COAL_PLANT);
			stampPond(state, cx + 5, cy + 2);
			stampCivic(state, cx + 6, cy + 2, CIVIC_WATER_PUMP);
			stampCivic(state, cx + 10, cy + 2, CIVIC_POLICE);
			stampCivic(state, cx + 14, cy + 2, CIVIC_FIRE_STATION);
			stampCivic(state, cx + 2, cy + 6, CIVIC_HOSPITAL);
			stampCivic(state, cx + 6, cy + 6, CIVIC_SCHOOL);
			stampCivic(state, cx + 10, cy + 6, CIVIC_PARK);
		}
	}
	stampCivic(state, 14, 6, CIVIC_STADIUM);
}

/** Replace the current city with a deterministic pre-built downtown. */
export function buildTestCity(state: CityState): void {
	resetCity(state);
	buildTestTerrain(state);

	const x0 = Math.max(0, Math.floor((state.width - SPAN) / 2));
	const y0 = Math.max(0, Math.floor((state.height - SPAN) / 2));

	layRoads(state, x0, y0);
	layBlocks(state, x0, y0);
	placePowerPlant(state, x0, y0);
}

/**
 * Give the demo rolling 3D relief. `generateTerrain` writes both elevation and
 * water; we then force every tile back to land so the downtown grid always sits
 * on buildable ground (no roads or buildings stranded on water), while keeping
 * the varied elevation the renderer extrudes into hills.
 */
function buildTestTerrain(state: CityState): void {
	generateTerrain(state, TEST_CITY_TERRAIN_SEED);
	state.terrain.fill(TERRAIN_LAND);
	state.waterLevel.fill(0);
}

function resetCity(state: CityState): void {
	state.terrain.fill(TERRAIN_LAND);
	state.roads.fill(0);
	state.rail.fill(0);
	state.powerLines.fill(0);
	state.waterPipes.fill(0);
	state.civic.fill(0);
	state.zoning.fill(0);
	state.densityCap.fill(0);
	state.building.fill(0);
	state.population.fill(0);
	state.jobs.fill(0);
	state.pollution.fill(0);
	state.traffic.fill(0);
	state.landValue.fill(0);
	state.elevation.fill(5);
	state.vertexHeights.fill(5);
	state.waterLevel.fill(0);
	state.power.fill(0);
	state.waterCoverage.fill(0);
	state.crime.fill(0);
	state.policeCoverage.fill(0);
	state.fireCoverage.fill(0);
	state.fire.fill(0);
	state.educationCoverage.fill(0);
	state.healthCoverage.fill(0);

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

/** Place a coal power plant just outside the grid's top-left corner. */
function placePowerPlant(state: CityState, x0: number, y0: number): void {
	const px = Math.max(0, x0 - 2);
	const py = Math.max(0, y0 - 2);
	if (!inBounds(state.width, state.height, px, py)) return;
	const idx = tileIndex(state.width, px, py);
	state.civic[idx] = CIVIC_COAL_PLANT;
	state.roads[idx] = 0;
	state.zoning[idx] = ZONE_NONE;
	state.building[idx] = 0;
}

function setRoad(state: CityState, x: number, y: number): void {
	if (!inBounds(state.width, state.height, x, y)) return;
	const idx = tileIndex(state.width, x, y);
	state.roads[idx] = 1;
	state.zoning[idx] = ZONE_NONE;
	state.densityCap[idx] = 0;
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
	state.densityCap[idx] = spec.density;
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
