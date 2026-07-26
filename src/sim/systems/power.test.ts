import { describe, expect, it } from "vitest";
import { type CityState, createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_HIGH,
	BUILDING_LOW,
	CIVIC_COAL_PLANT,
	CIVIC_SOLAR_PLANT,
	POWER_DEMAND_PER_DENSITY,
	POWER_OUTPUT,
	TERRAIN_WATER,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updatePower } from "./power.ts";

const W = 12;
const H = 12;

function smallCity(): CityState {
	return createCity({ width: W, height: H, seed: 1 });
}

function idx(x: number, y: number): number {
	return y * W + x;
}

describe("updatePower — sources and reach", () => {
	it("powers nothing when no plants exist", () => {
		const city = smallCity();
		city.roads[idx(4, 4)] = 1;

		updatePower(city);

		expect(city.aggregates[AGG.POWER_CAPACITY]).toBe(0);
		expect(city.power[idx(4, 4)]).toBe(0);
	});

	it("sums capacity across plant types", () => {
		const city = smallCity();
		city.civic[idx(2, 2)] = CIVIC_COAL_PLANT;
		city.civic[idx(9, 9)] = CIVIC_SOLAR_PLANT;

		updatePower(city);

		expect(city.aggregates[AGG.POWER_CAPACITY]).toBe(
			(POWER_OUTPUT[CIVIC_COAL_PLANT] ?? 0) +
				(POWER_OUTPUT[CIVIC_SOLAR_PLANT] ?? 0),
		);
	});

	it("spreads down a road connected to the plant", () => {
		const city = smallCity();
		city.civic[idx(1, 5)] = CIVIC_COAL_PLANT;
		for (let x = 2; x <= 9; x++) city.roads[idx(x, 5)] = 1;

		updatePower(city);

		expect(city.power[idx(9, 5)]).toBe(1);
	});

	it("does not jump a gap, but a power line bridges it", () => {
		const gapped = smallCity();
		gapped.civic[idx(1, 5)] = CIVIC_COAL_PLANT;
		gapped.roads[idx(2, 5)] = 1;
		gapped.roads[idx(4, 5)] = 1;

		const bridged = smallCity();
		bridged.civic[idx(1, 5)] = CIVIC_COAL_PLANT;
		bridged.roads[idx(2, 5)] = 1;
		bridged.powerLines[idx(3, 5)] = 1;
		bridged.roads[idx(4, 5)] = 1;

		updatePower(gapped);
		updatePower(bridged);

		expect(gapped.power[idx(4, 5)]).toBe(0);
		expect(bridged.power[idx(4, 5)]).toBe(1);
	});

	it("does not conduct through water terrain", () => {
		const city = smallCity();
		city.civic[idx(1, 5)] = CIVIC_COAL_PLANT;
		city.roads[idx(2, 5)] = 1;
		city.terrain[idx(3, 5)] = TERRAIN_WATER;
		city.roads[idx(4, 5)] = 1;

		updatePower(city);

		expect(city.power[idx(4, 5)]).toBe(0);
	});

	it("scales demand by building density tier", () => {
		const city = smallCity();
		city.civic[idx(1, 1)] = CIVIC_COAL_PLANT;
		city.zoning[idx(5, 5)] = ZONE_RESIDENTIAL;
		city.building[idx(5, 5)] = BUILDING_LOW;
		city.zoning[idx(6, 6)] = ZONE_RESIDENTIAL;
		city.building[idx(6, 6)] = BUILDING_HIGH;

		updatePower(city);

		expect(city.aggregates[AGG.POWER_DEMAND]).toBe(
			(POWER_DEMAND_PER_DENSITY[BUILDING_LOW] ?? 0) +
				(POWER_DEMAND_PER_DENSITY[BUILDING_HIGH] ?? 0),
		);
	});
});

describe("updatePower — capacity falloff", () => {
	/**
	 * A solar plant (50 MW) at the west end of a road spine, with a high-density
	 * building (8 MW) on every road tile. `buildingCount` puts total demand
	 * either side of that 50 MW ceiling.
	 */
	function spineCity(buildingCount: number): CityState {
		const city = smallCity();
		city.civic[idx(1, 5)] = CIVIC_SOLAR_PLANT;
		for (let x = 2; x < W; x++) city.roads[idx(x, 5)] = 1;
		for (let i = 0; i < buildingCount; i++) {
			const x = 2 + (i % (W - 2));
			const y = i < W - 2 ? 4 : 6;
			city.zoning[idx(x, y)] = ZONE_RESIDENTIAL;
			city.building[idx(x, y)] = BUILDING_HIGH;
		}
		return city;
	}

	const HIGH_DEMAND = POWER_DEMAND_PER_DENSITY[BUILDING_HIGH];

	it("serves every building when capacity covers total demand", () => {
		// 6 * 8 = 48 MW against the solar plant's 50 MW.
		const city = spineCity(6);

		updatePower(city);

		expect(city.aggregates[AGG.POWER_DEMAND]).toBe(6 * HIGH_DEMAND);
		expect(city.aggregates[AGG.POWER_SERVED]).toBe(6 * HIGH_DEMAND);
		expect(city.power[idx(7, 4)]).toBe(1);
	});

	it("browns out the far end, not the whole city", () => {
		// 20 * 8 = 160 MW against 50 MW.
		const city = spineCity(20);

		updatePower(city);

		const capacity = city.aggregates[AGG.POWER_CAPACITY] ?? 0;
		const served = city.aggregates[AGG.POWER_SERVED] ?? 0;

		expect(city.aggregates[AGG.POWER_DEMAND]).toBeGreaterThan(capacity);
		expect(served).toBeGreaterThan(0);
		expect(served).toBeLessThanOrEqual(capacity);

		expect(city.power[idx(1, 5)]).toBe(1); // the plant
		expect(city.power[idx(2, 4)]).toBe(1); // nearest building
		expect(city.power[idx(W - 1, 6)]).toBe(0); // farthest building
	});

	it("a shortfall costs coverage in proportion, not all at once", () => {
		const mild = spineCity(8);
		const severe = spineCity(20);

		updatePower(mild);
		updatePower(severe);

		function covered(city: CityState): number {
			let n = 0;
			for (let i = 0; i < city.size; i++) {
				if (city.power[i] === 1) n++;
			}
			return n;
		}

		expect(covered(mild)).toBeGreaterThan(covered(severe));
		expect(covered(severe)).toBeGreaterThan(0);
	});

	it("is deterministic across identical runs", () => {
		const a = spineCity(20);
		const b = spineCity(20);

		updatePower(a);
		updatePower(b);

		expect(Array.from(a.power)).toEqual(Array.from(b.power));
		expect(a.aggregates[AGG.POWER_SERVED]).toBe(b.aggregates[AGG.POWER_SERVED]);
	});
});
