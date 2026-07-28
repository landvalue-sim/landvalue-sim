import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_HIGH,
	BUILDING_LOW,
	ZONE_COMMERCIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateTraffic } from "./traffic.ts";

/**
 * These tests pin the exact numeric behaviour of updateTraffic before it is
 * optimised (issue #11). The expected values are hand-derived from the model:
 * an occupied R tile sends a trip to every occupied C/I tile within Manhattan
 * radius TRAFFIC_SPREAD_RADIUS (6); the trip walks horizontally then
 * vertically; each ROAD tile at path-step k (1-based) gains
 * max(1, floor(load * TRAFFIC_DECAY^(k-1))) with load =
 * max(1, floor(density * (1 - railReduction))).
 */

function city16() {
	return createCity({ width: 16, height: 16, seed: 1 });
}

function at(x: number, y: number): number {
	return y * 16 + x;
}

describe("updateTraffic", () => {
	it("decays load along a straight road from a high-density R to a C", () => {
		const city = city16();
		// R(2,5) density 3 -> road (3,5)..(7,5) -> C(8,5), distance 6.
		city.zoning[at(2, 5)] = ZONE_RESIDENTIAL;
		city.building[at(2, 5)] = BUILDING_HIGH;
		city.zoning[at(8, 5)] = ZONE_COMMERCIAL;
		city.building[at(8, 5)] = BUILDING_LOW;
		for (let x = 3; x <= 7; x++) city.roads[at(x, 5)] = 1;

		updateTraffic(city);

		// load 3: step exponents 0,1,2,... -> 3, 1, 1, 1, 1
		expect(city.traffic[at(3, 5)]).toBe(3);
		expect(city.traffic[at(4, 5)]).toBe(1);
		expect(city.traffic[at(5, 5)]).toBe(1);
		expect(city.traffic[at(6, 5)]).toBe(1);
		expect(city.traffic[at(7, 5)]).toBe(1);
		// The C parcel is not a road; nothing accumulates there.
		expect(city.traffic[at(8, 5)]).toBe(0);
		// Aggregate: total 7 over 5 road tiles.
		expect(city.aggregates[AGG.TRAFFIC_CONGESTION]).toBeCloseTo(7 / 5, 10);
	});

	it("walks horizontally first, then vertically, on an L-shaped trip", () => {
		const city = city16();
		// R(2,2) density 3 -> C(5,4). Roads on the L: (3,2),(4,2),(5,2),(5,3).
		city.zoning[at(2, 2)] = ZONE_RESIDENTIAL;
		city.building[at(2, 2)] = BUILDING_HIGH;
		city.zoning[at(5, 4)] = ZONE_COMMERCIAL;
		city.building[at(5, 4)] = BUILDING_LOW;
		city.roads[at(3, 2)] = 1;
		city.roads[at(4, 2)] = 1;
		city.roads[at(5, 2)] = 1;
		city.roads[at(5, 3)] = 1;

		updateTraffic(city);

		// Horizontal steps at exponents 0,1,2 then vertical continues at 3.
		expect(city.traffic[at(3, 2)]).toBe(3);
		expect(city.traffic[at(4, 2)]).toBe(1);
		expect(city.traffic[at(5, 2)]).toBe(1);
		expect(city.traffic[at(5, 3)]).toBe(1);
		// Row the path never touches stays empty.
		expect(city.traffic[at(4, 3)]).toBe(0);
	});

	it("sums contributions when one R commutes to two C tiles", () => {
		const city = city16();
		// R(2,5) density 3 -> C(7,5) and C(8,5); roads (3,5)..(6,5).
		city.zoning[at(2, 5)] = ZONE_RESIDENTIAL;
		city.building[at(2, 5)] = BUILDING_HIGH;
		for (const cx of [7, 8]) {
			city.zoning[at(cx, 5)] = ZONE_COMMERCIAL;
			city.building[at(cx, 5)] = BUILDING_LOW;
		}
		for (let x = 3; x <= 6; x++) city.roads[at(x, 5)] = 1;

		updateTraffic(city);

		// Two overlapping trips: 3+3, 1+1, 1+1, 1+1.
		expect(city.traffic[at(3, 5)]).toBe(6);
		expect(city.traffic[at(4, 5)]).toBe(2);
		expect(city.traffic[at(5, 5)]).toBe(2);
		expect(city.traffic[at(6, 5)]).toBe(2);
	});

	it("rail anywhere on the map reduces every load (global reduction)", () => {
		const city = city16();
		city.zoning[at(2, 5)] = ZONE_RESIDENTIAL;
		city.building[at(2, 5)] = BUILDING_HIGH;
		city.zoning[at(8, 5)] = ZONE_COMMERCIAL;
		city.building[at(8, 5)] = BUILDING_LOW;
		for (let x = 3; x <= 7; x++) city.roads[at(x, 5)] = 1;
		// 64 rail tiles far from the commute: reduction = 64 * 0.005 = 0.32.
		for (let y = 12; y <= 15; y++) {
			for (let x = 0; x < 16; x++) city.rail[at(x, y)] = 1;
		}

		updateTraffic(city);

		// load = max(1, floor(3 * 0.68)) = 2 -> 2, then 1s.
		expect(city.traffic[at(3, 5)]).toBe(2);
		expect(city.traffic[at(4, 5)]).toBe(1);
		expect(city.traffic[at(7, 5)]).toBe(1);
	});

	it("caps the rail reduction at half the load", () => {
		// 128 rail tiles would give 0.64; the model clamps at 0.5.
		const city = createCity({ width: 32, height: 32, seed: 1 });
		city.zoning[5 * 32 + 2] = ZONE_RESIDENTIAL;
		city.building[5 * 32 + 2] = BUILDING_HIGH;
		city.zoning[5 * 32 + 8] = ZONE_COMMERCIAL;
		city.building[5 * 32 + 8] = BUILDING_LOW;
		for (let x = 3; x <= 7; x++) city.roads[5 * 32 + x] = 1;
		for (let y = 28; y <= 31; y++) {
			for (let x = 0; x < 32; x++) city.rail[y * 32 + x] = 1;
		}

		updateTraffic(city);

		// load = max(1, floor(3 * 0.5)) = 1 -> flat 1 along the path.
		expect(city.traffic[5 * 32 + 3]).toBe(1);
		expect(city.traffic[5 * 32 + 4]).toBe(1);
		expect(city.traffic[5 * 32 + 7]).toBe(1);
	});

	it("generates nothing beyond the spread radius", () => {
		const city = city16();
		// Distance 7 > TRAFFIC_SPREAD_RADIUS.
		city.zoning[at(2, 5)] = ZONE_RESIDENTIAL;
		city.building[at(2, 5)] = BUILDING_HIGH;
		city.zoning[at(9, 5)] = ZONE_COMMERCIAL;
		city.building[at(9, 5)] = BUILDING_LOW;
		for (let x = 3; x <= 8; x++) city.roads[at(x, 5)] = 1;

		updateTraffic(city);

		for (let i = 0; i < city.size; i++) {
			expect(city.traffic[i]).toBe(0);
		}
		expect(city.aggregates[AGG.TRAFFIC_CONGESTION]).toBe(0);
	});

	it("ignores unbuilt zones on both ends of the trip", () => {
		const city = city16();
		// Zoned but empty R, built C — and built R, zoned but empty C.
		city.zoning[at(2, 5)] = ZONE_RESIDENTIAL; // building stays EMPTY
		city.zoning[at(8, 5)] = ZONE_COMMERCIAL;
		city.building[at(8, 5)] = BUILDING_LOW;
		city.zoning[at(2, 9)] = ZONE_RESIDENTIAL;
		city.building[at(2, 9)] = BUILDING_LOW;
		city.zoning[at(8, 9)] = ZONE_COMMERCIAL; // building stays EMPTY
		for (let x = 3; x <= 7; x++) {
			city.roads[at(x, 5)] = 1;
			city.roads[at(x, 9)] = 1;
		}

		updateTraffic(city);

		for (let i = 0; i < city.size; i++) {
			expect(city.traffic[i]).toBe(0);
		}
	});

	it("recomputes from scratch, clearing stale traffic", () => {
		const city = city16();
		city.traffic.fill(7); // garbage from a previous state

		updateTraffic(city);

		for (let i = 0; i < city.size; i++) {
			expect(city.traffic[i]).toBe(0);
		}
	});

	it("matches the pinned layer on a dense 64x64 grid city", () => {
		// A worst-case-shaped city: 4-stride road grid, every block built out
		// high-density, block columns alternating C and R. The summary values
		// were produced by the pre-optimisation implementation; an optimised
		// updateTraffic must reproduce them exactly.
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
				city.building[i] = BUILDING_HIGH;
			}
		}

		updateTraffic(city);

		let sum = 0;
		let max = 0;
		for (let i = 0; i < city.size; i++) {
			const t = city.traffic[i] ?? 0;
			sum += t;
			if (t > max) max = t;
		}
		expect({
			sum,
			max,
			congestion: city.aggregates[AGG.TRAFFIC_CONGESTION],
			spots: [
				city.traffic[8 * 64 + 8],
				city.traffic[20 * 64 + 33],
				city.traffic[32 * 64 + 32],
				city.traffic[45 * 64 + 12],
			],
		}).toEqual({
			sum: 52500,
			max: 66,
			congestion: 29.296875,
			spots: [0, 22, 0, 66],
		});
	});
});
