import { describe, expect, it } from "vitest";
import { createCity } from "./city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	STARTING_TREASURY,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
import { buildTestCity } from "./scenarios.ts";
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
