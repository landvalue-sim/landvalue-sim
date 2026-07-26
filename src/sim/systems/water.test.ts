import { describe, expect, it } from "vitest";
import { type CityState, createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_HIGH,
	BUILDING_LOW,
	CIVIC_WATER_PUMP,
	TERRAIN_WATER,
	WATER_DEMAND_PER_DENSITY,
	WATER_OUTPUT_PER_PUMP,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateWater } from "./water.ts";

const W = 12;
const H = 12;

function smallCity(): CityState {
	return createCity({ width: W, height: H, seed: 1 });
}

function idx(x: number, y: number): number {
	return y * W + x;
}

/** A pump at (x, y) with a lake tile immediately to its left, so it draws. */
function placeActivePump(city: CityState, x: number, y: number): void {
	city.terrain[idx(x - 1, y)] = TERRAIN_WATER;
	city.civic[idx(x, y)] = CIVIC_WATER_PUMP;
}

describe("updateWater — pump activation", () => {
	it("covers nothing when no pumps exist", () => {
		const city = smallCity();
		city.roads[idx(4, 4)] = 1;

		updateWater(city);

		expect(city.waterCoverage[idx(4, 4)]).toBe(0);
		expect(city.aggregates[AGG.WATER_CAPACITY]).toBe(0);
	});

	it("ignores a pump that is not adjacent to water", () => {
		const city = smallCity();
		city.civic[idx(5, 5)] = CIVIC_WATER_PUMP;
		city.roads[idx(6, 5)] = 1;

		updateWater(city);

		expect(city.aggregates[AGG.WATER_CAPACITY]).toBe(0);
		expect(city.waterCoverage[idx(5, 5)]).toBe(0);
		expect(city.waterCoverage[idx(6, 5)]).toBe(0);
	});

	it("activates a pump orthogonally adjacent to water", () => {
		const city = smallCity();
		placeActivePump(city, 5, 5);

		updateWater(city);

		expect(city.aggregates[AGG.WATER_CAPACITY]).toBe(WATER_OUTPUT_PER_PUMP);
		expect(city.waterCoverage[idx(5, 5)]).toBe(1);
	});

	it("does not activate a pump that only touches water diagonally", () => {
		const city = smallCity();
		city.terrain[idx(4, 4)] = TERRAIN_WATER;
		city.civic[idx(5, 5)] = CIVIC_WATER_PUMP;

		updateWater(city);

		expect(city.aggregates[AGG.WATER_CAPACITY]).toBe(0);
	});

	it("sums capacity across active pumps only", () => {
		const city = smallCity();
		placeActivePump(city, 3, 3);
		placeActivePump(city, 3, 8);
		city.civic[idx(9, 9)] = CIVIC_WATER_PUMP; // inland, inactive

		updateWater(city);

		expect(city.aggregates[AGG.WATER_CAPACITY]).toBe(2 * WATER_OUTPUT_PER_PUMP);
	});
});

describe("updateWater — network reach", () => {
	it("spreads along a road connected to the pump", () => {
		const city = smallCity();
		placeActivePump(city, 2, 5);
		for (let x = 3; x <= 9; x++) city.roads[idx(x, 5)] = 1;

		updateWater(city);

		expect(city.waterCoverage[idx(9, 5)]).toBe(1);
	});

	it("does not jump a gap in the network", () => {
		const city = smallCity();
		placeActivePump(city, 2, 5);
		city.roads[idx(3, 5)] = 1;
		// (4,5) is bare ground — the break in the chain.
		city.roads[idx(5, 5)] = 1;

		updateWater(city);

		expect(city.waterCoverage[idx(3, 5)]).toBe(1);
		expect(city.waterCoverage[idx(4, 5)]).toBe(0);
		expect(city.waterCoverage[idx(5, 5)]).toBe(0);
	});

	it("bridges that gap once a pipe is laid across it", () => {
		const city = smallCity();
		placeActivePump(city, 2, 5);
		city.roads[idx(3, 5)] = 1;
		city.waterPipes[idx(4, 5)] = 1;
		city.roads[idx(5, 5)] = 1;

		updateWater(city);

		expect(city.waterCoverage[idx(4, 5)]).toBe(1);
		expect(city.waterCoverage[idx(5, 5)]).toBe(1);
	});

	it("does not conduct through water terrain", () => {
		const city = smallCity();
		placeActivePump(city, 2, 5);
		city.roads[idx(3, 5)] = 1;
		city.terrain[idx(4, 5)] = TERRAIN_WATER;
		city.waterPipes[idx(4, 5)] = 1; // pipe on a flooded tile stays inert
		city.roads[idx(5, 5)] = 1;

		updateWater(city);

		expect(city.waterCoverage[idx(5, 5)]).toBe(0);
	});

	it("counts demand from every building, connected or not", () => {
		const city = smallCity();
		placeActivePump(city, 2, 5);
		// Stranded building with no path back to the pump.
		city.zoning[idx(10, 10)] = ZONE_RESIDENTIAL;
		city.building[idx(10, 10)] = BUILDING_LOW;

		updateWater(city);

		expect(city.aggregates[AGG.WATER_DEMAND]).toBe(
			WATER_DEMAND_PER_DENSITY[BUILDING_LOW],
		);
		expect(city.waterCoverage[idx(10, 10)]).toBe(0);
		// Nothing reachable drew anything, so nothing was served.
		expect(city.aggregates[AGG.WATER_SERVED]).toBe(0);
	});
});

describe("updateWater — capacity falloff", () => {
	/**
	 * One pump at the west end of a road spine, with a high-density building
	 * hanging off every road tile. `buildingCount` controls total demand, so a
	 * test can sit either side of the pump's WATER_OUTPUT_PER_PUMP capacity.
	 */
	function spineCity(buildingCount: number): CityState {
		const city = smallCity();
		placeActivePump(city, 1, 5);
		for (let x = 2; x < W; x++) city.roads[idx(x, 5)] = 1;
		for (let i = 0; i < buildingCount; i++) {
			// Fill westward-out: row 4 first, then row 6, so demand is added in
			// increasing distance from the pump.
			const x = 2 + (i % (W - 2));
			const y = i < W - 2 ? 4 : 6;
			city.zoning[idx(x, y)] = ZONE_RESIDENTIAL;
			city.building[idx(x, y)] = BUILDING_HIGH;
		}
		return city;
	}

	const HIGH_DEMAND = WATER_DEMAND_PER_DENSITY[BUILDING_HIGH];

	it("serves every building when capacity covers total demand", () => {
		// 8 high-density buildings * 5 = 40 units, under the pump's 50.
		const city = spineCity(8);

		updateWater(city);

		expect(city.aggregates[AGG.WATER_DEMAND]).toBe(8 * HIGH_DEMAND);
		expect(city.aggregates[AGG.WATER_CAPACITY]).toBe(WATER_OUTPUT_PER_PUMP);
		expect(city.aggregates[AGG.WATER_SERVED]).toBe(8 * HIGH_DEMAND);
		expect(city.waterCoverage[idx(9, 4)]).toBe(1);
	});

	it("keeps the near end wet and cuts the far end when short", () => {
		// 20 buildings * 5 = 100 units against a single 50-unit pump.
		const city = spineCity(20);

		updateWater(city);

		const demand = city.aggregates[AGG.WATER_DEMAND] ?? 0;
		const capacity = city.aggregates[AGG.WATER_CAPACITY] ?? 0;
		const served = city.aggregates[AGG.WATER_SERVED] ?? 0;

		expect(demand).toBe(20 * HIGH_DEMAND);
		expect(demand).toBeGreaterThan(capacity);
		// Supply is spent, not abandoned — the old model zeroed the whole city.
		expect(served).toBeGreaterThan(0);
		expect(served).toBeLessThanOrEqual(capacity);

		expect(city.waterCoverage[idx(1, 5)]).toBe(1); // the pump itself
		expect(city.waterCoverage[idx(2, 4)]).toBe(1); // nearest building
		expect(city.waterCoverage[idx(W - 1, 6)]).toBe(0); // farthest building
	});

	it("extends the frontier when a second pump is added", () => {
		const short = spineCity(20);
		const doubled = spineCity(20);
		placeActivePump(doubled, 1, 7);
		doubled.roads[idx(2, 7)] = 1;
		doubled.roads[idx(2, 6)] = 1;

		updateWater(short);
		updateWater(doubled);

		function covered(city: CityState): number {
			let n = 0;
			for (let i = 0; i < city.size; i++) {
				if (city.waterCoverage[i] === 1) n++;
			}
			return n;
		}

		expect(doubled.aggregates[AGG.WATER_CAPACITY]).toBe(
			2 * WATER_OUTPUT_PER_PUMP,
		);
		expect(covered(doubled)).toBeGreaterThan(covered(short));
	});

	it("is deterministic across identical runs", () => {
		const a = spineCity(20);
		const b = spineCity(20);

		updateWater(a);
		updateWater(b);

		expect(Array.from(a.waterCoverage)).toEqual(Array.from(b.waterCoverage));
		expect(a.aggregates[AGG.WATER_SERVED]).toBe(b.aggregates[AGG.WATER_SERVED]);
	});
});
