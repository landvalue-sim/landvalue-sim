import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	BUILDING_LOW,
	LV_BASE,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateLandValue } from "./land-value.ts";

function smallCity() {
	return createCity({ width: 8, height: 8, seed: 1 });
}

describe("updateLandValue", () => {
	it("assigns base value to empty land tiles", () => {
		const city = smallCity();
		updateLandValue(city);

		// Interior tiles should have at least the base value
		const center = 4 * 8 + 4;
		expect(city.landValue[center]).toBeGreaterThanOrEqual(LV_BASE - 2);
	});

	it("assigns zero to water tiles", () => {
		const city = smallCity();
		const idx = 3 * 8 + 3;
		city.terrain[idx] = 1; // water

		updateLandValue(city);

		expect(city.landValue[idx]).toBe(0);
	});

	it("road tiles have higher value than empty land", () => {
		const city = smallCity();
		const roadIdx = 4 * 8 + 4;
		const emptyIdx = 4 * 8 + 2;
		city.roads[roadIdx] = 1;

		updateLandValue(city);

		const roadValue = city.landValue[roadIdx] ?? 0;
		const emptyValue = city.landValue[emptyIdx] ?? 0;
		expect(roadValue).toBeGreaterThan(emptyValue);
	});

	it("tiles adjacent to roads get a bonus", () => {
		const city = smallCity();
		// Place a road at (4,4)
		city.roads[4 * 8 + 4] = 1;

		updateLandValue(city);

		// Adjacent tile (3,4) should have more value than distant tile (0,0)
		const adjValue = city.landValue[4 * 8 + 3] ?? 0;
		const farValue = city.landValue[0 * 8 + 0] ?? 0;
		expect(adjValue).toBeGreaterThan(farValue);
	});

	it("industrial neighbors reduce land value", () => {
		const city = smallCity();

		// Place R zone at (4,4), I zone at (4,5)
		const rIdx = 4 * 8 + 4;
		const iIdx = 5 * 8 + 4;
		city.zoning[rIdx] = ZONE_RESIDENTIAL;
		city.zoning[iIdx] = ZONE_INDUSTRIAL;
		city.building[iIdx] = BUILDING_LOW;

		updateLandValue(city);

		// R tile next to I should have lower value than R tile far from I
		const nearI = city.landValue[rIdx] ?? 0;

		// Compare with an isolated R tile
		const city2 = smallCity();
		city2.zoning[rIdx] = ZONE_RESIDENTIAL;
		updateLandValue(city2);
		const farFromI = city2.landValue[rIdx] ?? 0;

		expect(nearI).toBeLessThan(farFromI);
	});

	it("diffusion smooths values across neighbors", () => {
		const city = smallCity();
		// Place a road to create a high-value point
		city.roads[4 * 8 + 4] = 1;

		updateLandValue(city);

		// Neighbors should have picked up some value from diffusion
		const roadValue = city.landValue[4 * 8 + 4] ?? 0;
		const neighborValue = city.landValue[4 * 8 + 3] ?? 0;
		const farValue = city.landValue[0 * 8 + 0] ?? 0;

		expect(neighborValue).toBeGreaterThan(farValue);
		expect(roadValue).toBeGreaterThanOrEqual(neighborValue);
	});

	it("is deterministic", () => {
		function run() {
			const city = smallCity();
			city.roads[4 * 8 + 4] = 1;
			city.zoning[3 * 8 + 3] = ZONE_RESIDENTIAL;
			city.zoning[5 * 8 + 5] = ZONE_COMMERCIAL;
			city.building[5 * 8 + 5] = BUILDING_LOW;
			updateLandValue(city);
			return Array.from(city.landValue);
		}

		expect(run()).toEqual(run());
	});
});
