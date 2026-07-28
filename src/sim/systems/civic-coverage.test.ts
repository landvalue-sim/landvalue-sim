import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	CIVIC_COLLEGE,
	CIVIC_COVERAGE_RADIUS,
	CIVIC_FIRE_STATION,
	CIVIC_HOSPITAL,
	CIVIC_PARK,
	CIVIC_POLICE,
	CIVIC_SCHOOL,
	CIVIC_STADIUM,
} from "../constants.ts";
import { updateCivicCoverage } from "./civic-coverage.ts";

/**
 * Coverage is a Manhattan diamond of radius CIVIC_COVERAGE_RADIUS[type]
 * around each station: police -> policeCoverage, fire -> fireCoverage,
 * hospital -> healthCoverage, school/college/library -> educationCoverage.
 * An interior diamond of radius r covers 2r(r+1)+1 tiles.
 */

function diamondArea(r: number): number {
	return 2 * r * (r + 1) + 1;
}

function countLayer(layer: Uint8Array, size: number): number {
	let n = 0;
	for (let i = 0; i < size; i++) {
		n += layer[i] ?? 0;
	}
	return n;
}

describe("updateCivicCoverage", () => {
	it("covers an exact Manhattan diamond around a police station", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		const r = CIVIC_COVERAGE_RADIUS[CIVIC_POLICE] ?? 0;
		city.civic[32 * 64 + 32] = CIVIC_POLICE;

		updateCivicCoverage(city);

		expect(city.policeCoverage[32 * 64 + 32]).toBe(1);
		expect(city.policeCoverage[32 * 64 + (32 + r)]).toBe(1); // exactly r
		expect(city.policeCoverage[32 * 64 + (32 + r + 1)]).toBe(0); // r + 1
		expect(city.policeCoverage[(32 + r) * 64 + 32]).toBe(1);
		// One diagonal step past the diamond edge.
		expect(city.policeCoverage[(32 + r) * 64 + 33]).toBe(0);
		expect(countLayer(city.policeCoverage, city.size)).toBe(diamondArea(r));
		// Other layers untouched.
		expect(countLayer(city.fireCoverage, city.size)).toBe(0);
		expect(countLayer(city.healthCoverage, city.size)).toBe(0);
		expect(countLayer(city.educationCoverage, city.size)).toBe(0);
	});

	it("routes each civic type to its own layer with its own radius", () => {
		const city = createCity({ width: 96, height: 96, seed: 1 });
		city.civic[20 * 96 + 20] = CIVIC_FIRE_STATION;
		city.civic[70 * 96 + 70] = CIVIC_HOSPITAL;

		updateCivicCoverage(city);

		const fireR = CIVIC_COVERAGE_RADIUS[CIVIC_FIRE_STATION] ?? 0;
		const hospR = CIVIC_COVERAGE_RADIUS[CIVIC_HOSPITAL] ?? 0;
		expect(countLayer(city.fireCoverage, city.size)).toBe(diamondArea(fireR));
		expect(countLayer(city.healthCoverage, city.size)).toBe(diamondArea(hospR));
		expect(countLayer(city.policeCoverage, city.size)).toBe(0);
	});

	it("clips the diamond at the map border", () => {
		const city = createCity({ width: 32, height: 32, seed: 1 });
		const r = CIVIC_COVERAGE_RADIUS[CIVIC_POLICE] ?? 0;
		city.civic[0] = CIVIC_POLICE; // corner (0,0)

		updateCivicCoverage(city);

		// Only the quadrant with x + y <= r survives: sum of (d+1) for d 0..r.
		const quadrant = ((r + 1) * (r + 2)) / 2;
		expect(countLayer(city.policeCoverage, city.size)).toBe(quadrant);
	});

	it("gives parks and stadiums no coverage at all", () => {
		const city = createCity({ width: 32, height: 32, seed: 1 });
		city.civic[10 * 32 + 10] = CIVIC_PARK;
		city.civic[20 * 32 + 20] = CIVIC_STADIUM;

		updateCivicCoverage(city);

		expect(countLayer(city.policeCoverage, city.size)).toBe(0);
		expect(countLayer(city.fireCoverage, city.size)).toBe(0);
		expect(countLayer(city.healthCoverage, city.size)).toBe(0);
		expect(countLayer(city.educationCoverage, city.size)).toBe(0);
	});

	it("resets stale coverage when the stations are gone", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		city.policeCoverage.fill(1);
		city.fireCoverage.fill(1);
		city.educationCoverage.fill(1);
		city.healthCoverage.fill(1);

		updateCivicCoverage(city);

		expect(countLayer(city.policeCoverage, city.size)).toBe(0);
		expect(countLayer(city.fireCoverage, city.size)).toBe(0);
		expect(countLayer(city.educationCoverage, city.size)).toBe(0);
		expect(countLayer(city.healthCoverage, city.size)).toBe(0);
		expect(city.aggregates[AGG.EDUCATION_LEVEL]).toBe(0);
		expect(city.aggregates[AGG.HEALTH_LEVEL]).toBe(0);
	});

	it("publishes education and health levels as covered-area percentages", () => {
		const city = createCity({ width: 64, height: 64, seed: 1 });
		const schoolR = CIVIC_COVERAGE_RADIUS[CIVIC_SCHOOL] ?? 0;
		const hospR = CIVIC_COVERAGE_RADIUS[CIVIC_HOSPITAL] ?? 0;
		city.civic[32 * 64 + 32] = CIVIC_SCHOOL;
		city.civic[30 * 64 + 30] = CIVIC_HOSPITAL;

		updateCivicCoverage(city);

		expect(city.aggregates[AGG.EDUCATION_LEVEL]).toBe(
			(diamondArea(schoolR) / city.size) * 100,
		);
		expect(city.aggregates[AGG.HEALTH_LEVEL]).toBe(
			(diamondArea(hospR) / city.size) * 100,
		);
	});

	it("matches the pinned counts with overlapping and clipped stations", () => {
		// Several stations of every kind, some overlapping, some clipped at
		// the border. Counts were produced by the current implementation.
		const city = createCity({ width: 96, height: 96, seed: 1 });
		city.civic[5 * 96 + 5] = CIVIC_POLICE; // clipped
		city.civic[20 * 96 + 30] = CIVIC_POLICE; // overlaps the next one
		city.civic[30 * 96 + 40] = CIVIC_POLICE;
		city.civic[2 * 96 + 90] = CIVIC_FIRE_STATION; // clipped
		city.civic[50 * 96 + 50] = CIVIC_FIRE_STATION;
		city.civic[60 * 96 + 60] = CIVIC_HOSPITAL;
		city.civic[70 * 96 + 68] = CIVIC_HOSPITAL; // overlaps
		city.civic[80 * 96 + 10] = CIVIC_SCHOOL;
		city.civic[85 * 96 + 20] = CIVIC_COLLEGE; // overlaps the school
		city.civic[95 * 96 + 95] = CIVIC_SCHOOL; // corner clip

		updateCivicCoverage(city);

		expect({
			police: countLayer(city.policeCoverage, city.size),
			fire: countLayer(city.fireCoverage, city.size),
			health: countLayer(city.healthCoverage, city.size),
			education: countLayer(city.educationCoverage, city.size),
			eduLevel: city.aggregates[AGG.EDUCATION_LEVEL],
			healthLevel: city.aggregates[AGG.HEALTH_LEVEL],
		}).toEqual({
			police: 1193,
			fire: 721,
			health: 1233,
			education: 1007,
			eduLevel: 10.926649305555555,
			healthLevel: 13.37890625,
		});
	});
});
