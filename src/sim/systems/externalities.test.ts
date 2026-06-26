import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	BUILDING_LOW,
	POLLUTION_PER_INDUSTRIAL,
	ZONE_INDUSTRIAL,
} from "../constants.ts";
import { updateExternalities } from "./externalities.ts";

function smallCity() {
	return createCity({ width: 8, height: 8, seed: 1 });
}

describe("updateExternalities", () => {
	it("industrial tile generates pollution at its location", () => {
		const city = smallCity();
		const idx = 4 * 8 + 4;
		city.zoning[idx] = ZONE_INDUSTRIAL;
		city.building[idx] = BUILDING_LOW;

		updateExternalities(city);

		expect(city.pollution[idx]).toBe(POLLUTION_PER_INDUSTRIAL);
	});

	it("pollution spreads to nearby tiles with decay", () => {
		const city = smallCity();
		const idx = 4 * 8 + 4;
		city.zoning[idx] = ZONE_INDUSTRIAL;
		city.building[idx] = BUILDING_LOW;

		updateExternalities(city);

		// Orthogonal neighbor (distance 1)
		const adj = city.pollution[4 * 8 + 5] ?? 0;
		expect(adj).toBeGreaterThan(0);
		expect(adj).toBeLessThan(POLLUTION_PER_INDUSTRIAL);

		// Distant tile (distance 3)
		const far = city.pollution[4 * 8 + 7] ?? 0;
		expect(far).toBeLessThan(adj);
	});

	it("no pollution from empty industrial zones", () => {
		const city = smallCity();
		city.zoning[0] = ZONE_INDUSTRIAL;
		city.building[0] = BUILDING_EMPTY;

		updateExternalities(city);

		expect(city.pollution[0]).toBe(0);
	});

	it("multiple industrial tiles stack pollution", () => {
		const city = smallCity();

		// Two adjacent I tiles
		city.zoning[4 * 8 + 3] = ZONE_INDUSTRIAL;
		city.building[4 * 8 + 3] = BUILDING_LOW;
		city.zoning[4 * 8 + 5] = ZONE_INDUSTRIAL;
		city.building[4 * 8 + 5] = BUILDING_LOW;

		updateExternalities(city);

		// Tile between them should have stacked pollution
		const between = city.pollution[4 * 8 + 4] ?? 0;
		const isolated = (() => {
			const c = smallCity();
			c.zoning[4 * 8 + 3] = ZONE_INDUSTRIAL;
			c.building[4 * 8 + 3] = BUILDING_LOW;
			updateExternalities(c);
			return c.pollution[4 * 8 + 4] ?? 0;
		})();

		expect(between).toBeGreaterThan(isolated);
	});

	it("resets pollution each tick", () => {
		const city = smallCity();
		city.zoning[0] = ZONE_INDUSTRIAL;
		city.building[0] = BUILDING_LOW;

		updateExternalities(city);
		const firstPol = city.pollution[0];

		// Remove the building
		city.building[0] = BUILDING_EMPTY;
		updateExternalities(city);

		expect(city.pollution[0]).toBe(0);
		expect(firstPol).toBeGreaterThan(0);
	});
});
