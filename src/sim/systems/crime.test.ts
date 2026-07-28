import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_HIGH,
	BUILDING_LOW,
	CRIME_BASE,
	CRIME_DENSITY_FACTOR,
	CRIME_LOW_VALUE_BONUS,
	CRIME_LOW_VALUE_THRESHOLD,
	ZONE_COMMERCIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateCrime } from "./crime.ts";

/**
 * These tests pin the exact numeric behaviour of updateCrime. Crime on an
 * occupied zoned tile is CRIME_BASE + tier * CRIME_DENSITY_FACTOR, plus
 * CRIME_LOW_VALUE_BONUS below the land-value threshold, plus
 * floor(unemployment * CRIME_UNEMPLOYMENT_FACTOR * 100), all cut to 30% by
 * police coverage (floored). Unemployment is
 * max(0, 1 - totalJobs * 2.5 / totalPop) from the aggregates.
 */

function city16() {
	const city = createCity({ width: 16, height: 16, seed: 1 });
	// Balanced labour market unless a test says otherwise: unemployment 0.
	city.aggregates[AGG.TOTAL_POP] = 1000;
	city.aggregates[AGG.TOTAL_C_JOBS] = 400;
	city.aggregates[AGG.TOTAL_I_JOBS] = 0;
	return city;
}

function occupy(
	city: ReturnType<typeof createCity>,
	idx: number,
	tier: number,
	landValue: number,
): void {
	city.zoning[idx] = ZONE_RESIDENTIAL;
	city.building[idx] = tier;
	city.landValue[idx] = landValue;
}

describe("updateCrime", () => {
	it("assigns zero to unzoned and unbuilt tiles, clearing stale values", () => {
		const city = city16();
		city.crime.fill(99); // garbage from a previous state
		city.zoning[5] = ZONE_COMMERCIAL; // zoned but never built

		updateCrime(city);

		for (let i = 0; i < city.size; i++) {
			expect(city.crime[i]).toBe(0);
		}
		expect(city.aggregates[AGG.TOTAL_CRIME]).toBe(0);
	});

	it("scales with density tier: base plus tier times the density factor", () => {
		const city = city16();
		occupy(city, 10, BUILDING_LOW, 100);
		occupy(city, 20, BUILDING_HIGH, 100);

		updateCrime(city);

		// 5 + 1*3 = 8 and 5 + 3*3 = 14, no other terms.
		expect(city.crime[10]).toBe(CRIME_BASE + 1 * CRIME_DENSITY_FACTOR);
		expect(city.crime[20]).toBe(CRIME_BASE + 3 * CRIME_DENSITY_FACTOR);
		expect(city.crime[10]).toBe(8);
		expect(city.crime[20]).toBe(14);
	});

	it("adds the low-value bonus strictly below the threshold", () => {
		const city = city16();
		occupy(city, 10, BUILDING_LOW, CRIME_LOW_VALUE_THRESHOLD - 1);
		occupy(city, 20, BUILDING_LOW, CRIME_LOW_VALUE_THRESHOLD);

		updateCrime(city);

		expect(city.crime[10]).toBe(8 + CRIME_LOW_VALUE_BONUS); // 16
		expect(city.crime[20]).toBe(8); // at the threshold: no bonus
	});

	it("adds a flat unemployment term derived from the aggregates", () => {
		const city = city16();
		occupy(city, 10, BUILDING_LOW, 100);
		// jobs * 2.5 / pop = 0.5 -> unemployment 0.5 -> floor(0.5 * 0.1 * 100) = 5
		city.aggregates[AGG.TOTAL_POP] = 1000;
		city.aggregates[AGG.TOTAL_C_JOBS] = 200;
		city.aggregates[AGG.TOTAL_I_JOBS] = 0;

		updateCrime(city);
		expect(city.crime[10]).toBe(8 + 5);

		// No jobs at all: unemployment 1 -> +10.
		city.aggregates[AGG.TOTAL_C_JOBS] = 0;
		updateCrime(city);
		expect(city.crime[10]).toBe(8 + 10);

		// Empty city: unemployment defined as 0.
		city.aggregates[AGG.TOTAL_POP] = 0;
		updateCrime(city);
		expect(city.crime[10]).toBe(8);
	});

	it("police coverage cuts crime to 30%, floored", () => {
		const city = city16();
		occupy(city, 10, BUILDING_HIGH, 5); // 5 + 9 + 8 = 22 uncovered
		occupy(city, 20, BUILDING_HIGH, 5);
		city.policeCoverage[20] = 1;

		updateCrime(city);

		expect(city.crime[10]).toBe(22);
		expect(city.crime[20]).toBe(Math.floor(22 * 0.3)); // 6
	});

	it("publishes the summed layer as TOTAL_CRIME", () => {
		const city = city16();
		occupy(city, 10, BUILDING_LOW, 100); // 8
		occupy(city, 20, BUILDING_HIGH, 5); // 22
		city.policeCoverage[20] = 1; // -> 6

		updateCrime(city);

		expect(city.aggregates[AGG.TOTAL_CRIME]).toBe(8 + 6);
	});

	it("matches the pinned layer on a dense 64x64 grid city", () => {
		// Same worst-case shape as the traffic pin: 4-stride road grid, all
		// blocks built high-density. Land value cycles so some tiles fall
		// below the low-value threshold, and a police diamond covers the
		// north-west quarter. Summary values were produced by the current
		// implementation; a changed updateCrime must reproduce them exactly.
		const city = createCity({ width: 64, height: 64, seed: 1 });
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				const i = y * 64 + x;
				if (x % 4 === 0 || y % 4 === 0) {
					city.roads[i] = 1;
					continue;
				}
				const commercial = Math.floor(x / 4) % 2 === 0;
				city.zoning[i] = commercial ? ZONE_COMMERCIAL : ZONE_RESIDENTIAL;
				city.building[i] = 1 + (i % 3);
				city.landValue[i] = (i * 7) % 40;
				if (x + y < 32) city.policeCoverage[i] = 1;
			}
		}
		// One-third employment -> unemployment 1 - 2.5/3 -> floor term 16.
		city.aggregates[AGG.TOTAL_POP] = 30000;
		city.aggregates[AGG.TOTAL_C_JOBS] = 4000;
		city.aggregates[AGG.TOTAL_I_JOBS] = 0;

		updateCrime(city);

		let sum = 0;
		let max = 0;
		for (let i = 0; i < city.size; i++) {
			const c = city.crime[i] ?? 0;
			sum += c;
			if (c > max) max = c;
		}
		expect({
			sum,
			max,
			total: city.aggregates[AGG.TOTAL_CRIME],
			spots: [
				city.crime[9 * 64 + 9],
				city.crime[9 * 64 + 50],
				city.crime[33 * 64 + 33],
				city.crime[50 * 64 + 13],
			],
		}).toEqual({
			sum: 42048,
			max: 28,
			total: 42048,
			spots: [4, 20, 14, 22],
		});
	});
});
