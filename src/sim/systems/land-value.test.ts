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

	it("road tiles carry no parcel value; the premium goes to adjacent land", () => {
		const city = smallCity();
		const roadIdx = 4 * 8 + 4;
		const adjIdx = 4 * 8 + 3; // orthogonally adjacent to the road
		const farIdx = 0; // (0,0), away from the road
		city.roads[roadIdx] = 1;

		updateLandValue(city);

		// The roadbed itself is worth nothing — it is not a taxable parcel.
		expect(city.landValue[roadIdx]).toBe(0);
		// The access premium capitalizes into the adjacent developable land.
		expect(city.landValue[adjIdx] ?? 0).toBeGreaterThan(
			city.landValue[farIdx] ?? 0,
		);
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

	it("diffusion spreads value outward from road-adjacent parcels", () => {
		const city = smallCity();
		// A road creates a ring of high-value adjacent parcels.
		city.roads[4 * 8 + 4] = 1;

		updateLandValue(city);

		const adj = city.landValue[4 * 8 + 3] ?? 0; // touches the road (peak)
		const twoAway = city.landValue[4 * 8 + 2] ?? 0; // one tile further out
		const far = city.landValue[0 * 8 + 0] ?? 0; // corner, away from the road

		// Value decays with distance, but diffusion still carries some outward.
		expect(adj).toBeGreaterThan(twoAway);
		expect(twoAway).toBeGreaterThan(far);
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
