import { describe, expect, it } from "vitest";
import { createCity } from "./city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_WATER_PUMP,
	STARTING_TREASURY,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
import { buildDenseCity, buildTestCity } from "./scenarios.ts";
import { clearViolations, getViolations } from "./sim-invariants.ts";
import { tick } from "./tick.ts";

describe("buildTestCity", () => {
	it("lays roads and all three zone types", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		buildTestCity(city);

		let roads = 0;
		let r = 0;
		let c = 0;
		let i = 0;
		for (let t = 0; t < city.size; t++) {
			if (city.roads[t] === 1) roads++;
			if (city.building[t] !== BUILDING_EMPTY) {
				if (city.zoning[t] === ZONE_RESIDENTIAL) r++;
				else if (city.zoning[t] === ZONE_COMMERCIAL) c++;
				else if (city.zoning[t] === ZONE_INDUSTRIAL) i++;
			}
		}

		expect(roads).toBeGreaterThan(0);
		expect(r).toBeGreaterThan(0);
		expect(c).toBeGreaterThan(0);
		expect(i).toBeGreaterThan(0);
	});

	it("never places a building on a road or unzoned tile", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		buildTestCity(city);

		for (let t = 0; t < city.size; t++) {
			if (city.building[t] !== BUILDING_EMPTY) {
				expect(city.roads[t]).toBe(0);
				expect(city.zoning[t]).not.toBe(ZONE_NONE);
			}
		}
	});

	it("resets treasury and produces population and jobs", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		city.aggregates[AGG.TREASURY] = -50000;

		buildTestCity(city);
		// One tick recomputes aggregate totals from the placed buildings.
		tick(city, []);

		expect(city.aggregates[AGG.TREASURY]).not.toBe(-50000);
		expect(city.aggregates[AGG.TOTAL_POP]).toBeGreaterThan(0);
		const jobs =
			(city.aggregates[AGG.TOTAL_C_JOBS] ?? 0) +
			(city.aggregates[AGG.TOTAL_I_JOBS] ?? 0);
		expect(jobs).toBeGreaterThan(0);
	});

	it("produces a city that passes all sim invariants", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		clearViolations();

		buildTestCity(city);
		// tick() runs the postcondition invariant checks in dev mode.
		tick(city, []);

		expect(getViolations()).toHaveLength(0);
	});

	it("is deterministic — same layout every call", () => {
		const a = createCity({ width: 64, height: 64, seed: 1 });
		const b = createCity({ width: 64, height: 64, seed: 999 });
		buildTestCity(a);
		buildTestCity(b);

		expect(Array.from(a.zoning)).toEqual(Array.from(b.zoning));
		expect(Array.from(a.building)).toEqual(Array.from(b.building));
		expect(Array.from(a.roads)).toEqual(Array.from(b.roads));
	});

	it("fits a smaller grid without writing out of bounds", () => {
		// SPAN (25) exceeds a 20x20 grid; clamping must keep writes in bounds.
		const city = createCity({ width: 20, height: 20, seed: 1 });
		expect(() => buildTestCity(city)).not.toThrow();
		expect(city.aggregates[AGG.TREASURY]).toBe(STARTING_TREASURY);

		clearViolations();
		tick(city, []);
		expect(getViolations()).toHaveLength(0);
		expect(Number.isFinite(city.aggregates[AGG.TREASURY] ?? NaN)).toBe(true);
	});
});

describe("buildDenseCity", () => {
	it("fills the map with roads, built R/C/I parcels, civics, and ponds", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		buildDenseCity(city);

		let roads = 0;
		let civics = 0;
		let water = 0;
		const zoneCounts = [0, 0, 0, 0];
		for (let t = 0; t < city.size; t++) {
			if (city.roads[t] === 1) {
				roads++;
				expect(city.building[t]).toBe(BUILDING_EMPTY);
			} else if ((city.civic[t] ?? 0) !== 0) {
				civics++;
				expect(city.building[t]).toBe(BUILDING_EMPTY);
			} else if (city.terrain[t] === TERRAIN_WATER) {
				water++;
				expect(city.building[t]).toBe(BUILDING_EMPTY);
			} else {
				// Every remaining tile is a built parcel of one of the three zones.
				expect(city.building[t]).not.toBe(BUILDING_EMPTY);
				const zone = city.zoning[t] ?? 0;
				zoneCounts[zone] = (zoneCounts[zone] ?? 0) + 1;
			}
		}
		expect(roads).toBeGreaterThan(0);
		expect(civics).toBeGreaterThan(0);
		expect(water).toBeGreaterThan(0);
		expect(zoneCounts[ZONE_NONE]).toBe(0);
		expect(zoneCounts[ZONE_RESIDENTIAL]).toBeGreaterThan(0);
		expect(zoneCounts[ZONE_COMMERCIAL]).toBeGreaterThan(0);
		expect(zoneCounts[ZONE_INDUSTRIAL]).toBeGreaterThan(0);
	});

	it("lays rail and places every water pump beside a pond", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		buildDenseCity(city);

		let rail = 0;
		let pumps = 0;
		for (let t = 0; t < city.size; t++) {
			if (city.rail[t] === 1) rail++;
			if (city.civic[t] === CIVIC_WATER_PUMP) {
				pumps++;
				// Orthogonally adjacent water, so updateWater treats it as active.
				const x = t % city.width;
				const adjacentWater =
					(x > 0 && city.terrain[t - 1] === TERRAIN_WATER) ||
					(x < city.width - 1 && city.terrain[t + 1] === TERRAIN_WATER) ||
					city.terrain[t - city.width] === TERRAIN_WATER ||
					city.terrain[t + city.width] === TERRAIN_WATER;
				expect(adjacentWater).toBe(true);
			}
		}
		expect(rail).toBeGreaterThan(0);
		expect(pumps).toBeGreaterThan(0);
	});

	it("produces a city that ticks without invariant violations", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		clearViolations();

		buildDenseCity(city);
		tick(city, []);

		expect(getViolations()).toHaveLength(0);
	});

	it("is deterministic — same layout every call", () => {
		const a = createCity({ width: 64, height: 64, seed: 1 });
		const b = createCity({ width: 64, height: 64, seed: 999 });
		buildDenseCity(a);
		buildDenseCity(b);

		expect(Array.from(a.zoning)).toEqual(Array.from(b.zoning));
		expect(Array.from(a.building)).toEqual(Array.from(b.building));
		expect(Array.from(a.roads)).toEqual(Array.from(b.roads));
	});
});
