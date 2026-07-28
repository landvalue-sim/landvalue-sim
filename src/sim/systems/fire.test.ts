import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_HIGH,
	BUILDING_LOW,
	TERRAIN_WATER,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateFire } from "./fire.ts";

/**
 * updateFire is driven entirely by the city's seeded PRNG, so every scenario
 * here is deterministic: same seed + same layout = same rolls = same fires.
 * The multi-tick outcomes are pinned from the current implementation — any
 * change to the roll order or the risk formulas will move them.
 */

function build(
	city: ReturnType<typeof createCity>,
	idx: number,
	zone: number,
	tier: number,
): void {
	city.zoning[idx] = zone;
	city.building[idx] = tier;
	city.population[idx] = zone === ZONE_RESIDENTIAL ? 40 : 0;
	city.jobs[idx] = zone === ZONE_RESIDENTIAL ? 0 : 25;
}

describe("updateFire", () => {
	it("does nothing on an empty city", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });

		for (let tick = 0; tick < 10; tick++) {
			updateFire(city);
		}

		for (let i = 0; i < city.size; i++) {
			expect(city.fire[i]).toBe(0);
		}
		expect(city.aggregates[AGG.FIRE_COUNT]).toBe(0);
	});

	it("containment destroys the building and clears its population and jobs", () => {
		const city = createCity({ width: 8, height: 8, seed: 1 });
		const idx = 3 * 8 + 3;
		build(city, idx, ZONE_RESIDENTIAL, BUILDING_LOW);
		city.fire[idx] = 1;

		// An isolated fire cannot spread (no flammable neighbors); with a 30%
		// containment chance per tick, 100 bounded ticks is far beyond enough.
		for (let tick = 0; tick < 100 && city.fire[idx] === 1; tick++) {
			updateFire(city);
		}

		expect(city.fire[idx]).toBe(0);
		expect(city.building[idx]).toBe(0);
		expect(city.population[idx]).toBe(0);
		expect(city.jobs[idx]).toBe(0);
	});

	it("never spreads to water or unbuilt tiles", () => {
		const city = createCity({ width: 8, height: 8, seed: 1 });
		const center = 3 * 8 + 3;
		build(city, center, ZONE_RESIDENTIAL, BUILDING_HIGH);
		city.fire[center] = 1;
		city.terrain[3 * 8 + 2] = TERRAIN_WATER; // west neighbor is water
		// North/south/east neighbors stay empty land with no buildings.

		for (let tick = 0; tick < 50; tick++) {
			updateFire(city);
			for (let i = 0; i < city.size; i++) {
				if (i !== center) expect(city.fire[i]).toBe(0);
			}
		}
	});

	it("eventually ignites a fire on a flammable grid", () => {
		// Every tile industrial high-density: ignition risk 1 + 4 + 6 = 11 per
		// check, 64 checks per tick. Bounded at 300 ticks; with seed 1 the
		// first ignition arrives well inside that.
		const city = createCity({ width: 8, height: 8, seed: 1 });
		for (let i = 0; i < city.size; i++) {
			build(city, i, ZONE_INDUSTRIAL, BUILDING_HIGH);
		}

		let ignited = false;
		for (let tick = 0; tick < 300 && !ignited; tick++) {
			updateFire(city);
			for (let i = 0; i < city.size; i++) {
				if (city.fire[i] === 1) ignited = true;
			}
		}

		expect(ignited).toBe(true);
	});

	it("is deterministic — same seed, same fires", () => {
		function run(): number[] {
			const city = createCity({ width: 16, height: 16, seed: 42 });
			for (let y = 5; y < 10; y++) {
				for (let x = 5; x < 10; x++) {
					build(city, y * 16 + x, ZONE_INDUSTRIAL, BUILDING_HIGH);
				}
			}
			city.fire[7 * 16 + 7] = 1;
			for (let tick = 0; tick < 10; tick++) {
				updateFire(city);
			}
			return Array.from(city.fire);
		}

		expect(run()).toEqual(run());
	});

	it("matches the pinned outcome of a burning block, covered vs uncovered", () => {
		// A 5x5 built block with two tiles alight, run 3 ticks. Fire coverage
		// suppresses spread (40% -> 8%) and speeds containment (30% -> 70%),
		// so the covered city must end with no more burning and no more
		// destroyed tiles than the uncovered one — and both runs are pinned.
		function run(covered: boolean) {
			const city = createCity({ width: 16, height: 16, seed: 2 });
			for (let y = 5; y < 10; y++) {
				for (let x = 5; x < 10; x++) {
					build(city, y * 16 + x, ZONE_RESIDENTIAL, BUILDING_HIGH);
				}
			}
			if (covered) city.fireCoverage.fill(1);
			city.fire[7 * 16 + 7] = 1;
			city.fire[5 * 16 + 5] = 1;

			for (let tick = 0; tick < 3; tick++) {
				updateFire(city);
			}

			let burning = 0;
			let destroyed = 0;
			for (let y = 5; y < 10; y++) {
				for (let x = 5; x < 10; x++) {
					const i = y * 16 + x;
					if (city.fire[i] === 1) burning++;
					if (city.building[i] === 0) destroyed++;
				}
			}
			return { burning, destroyed, agg: city.aggregates[AGG.FIRE_COUNT] };
		}

		const uncovered = run(false);
		const coveredRun = run(true);

		expect(uncovered).toEqual({ burning: 11, destroyed: 9, agg: 11 });
		expect(coveredRun).toEqual({ burning: 0, destroyed: 3, agg: 0 });
		expect(coveredRun.burning).toBeLessThanOrEqual(uncovered.burning);
		expect(coveredRun.destroyed).toBeLessThanOrEqual(uncovered.destroyed);
	});

	it("matches the pinned outcome on a dense 64x64 grid city", () => {
		// Same dense shape as the traffic and crime pins, five seed fires,
		// three ticks — few enough that fires are still burning when we look
		// (containment kills 30% of burning tiles per tick, so a cluster only
		// lives a handful of ticks). Pins the whole system: ignition, spread,
		// containment, destruction, and the FIRE_COUNT aggregate.
		const city = createCity({ width: 64, height: 64, seed: 1 });
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				const i = y * 64 + x;
				if (x % 4 === 0 || y % 4 === 0) {
					city.roads[i] = 1;
					continue;
				}
				build(
					city,
					i,
					Math.floor(x / 4) % 2 === 0 ? ZONE_INDUSTRIAL : ZONE_RESIDENTIAL,
					BUILDING_HIGH,
				);
			}
		}
		for (const seed of [
			9 * 64 + 9,
			9 * 64 + 50,
			33 * 64 + 33,
			50 * 64 + 13,
			58 * 64 + 58,
		]) {
			city.fire[seed] = 1;
		}

		for (let tick = 0; tick < 3; tick++) {
			updateFire(city);
		}

		let burning = 0;
		let destroyed = 0;
		for (let i = 0; i < city.size; i++) {
			if (city.fire[i] === 1) burning++;
			if (city.zoning[i] !== 0 && city.building[i] === 0) destroyed++;
		}
		expect({
			burning,
			destroyed,
			agg: city.aggregates[AGG.FIRE_COUNT],
		}).toEqual({ burning: 8, destroyed: 17, agg: 8 });
	});
});
