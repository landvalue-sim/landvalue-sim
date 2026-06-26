import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	ABANDON_DEMAND_THRESHOLD,
	AGG,
	BUILDING_EMPTY,
	BUILDING_LOW,
	GROWTH_DEMAND_THRESHOLD,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { processMigration } from "./migration.ts";

function smallCity() {
	return createCity({ width: 8, height: 8, seed: 1 });
}

describe("processMigration", () => {
	it("builds residential when R demand is high enough", () => {
		const city = smallCity();

		// Zone some R tiles and add road access
		city.roads[1 * 8 + 3] = 1; // road at (3,1)
		city.zoning[1 * 8 + 2] = ZONE_RESIDENTIAL; // R at (2,1) — adjacent to road
		city.zoning[1 * 8 + 4] = ZONE_RESIDENTIAL; // R at (4,1)

		// Give them some land value
		city.landValue[1 * 8 + 2] = 20;
		city.landValue[1 * 8 + 4] = 15;

		// Set high R demand
		city.aggregates[AGG.R_DEMAND] = GROWTH_DEMAND_THRESHOLD + 100;

		processMigration(city);

		// At least one building should appear
		const r1 = city.building[1 * 8 + 2];
		const r2 = city.building[1 * 8 + 4];
		expect(r1 === BUILDING_LOW || r2 === BUILDING_LOW).toBe(true);
	});

	it("does not build when demand is below threshold", () => {
		const city = smallCity();

		city.roads[1 * 8 + 3] = 1;
		city.zoning[1 * 8 + 2] = ZONE_RESIDENTIAL;
		city.landValue[1 * 8 + 2] = 20;

		city.aggregates[AGG.R_DEMAND] = GROWTH_DEMAND_THRESHOLD - 10;

		processMigration(city);

		expect(city.building[1 * 8 + 2]).toBe(BUILDING_EMPTY);
	});

	it("abandons buildings when demand is very negative", () => {
		const city = smallCity();
		const idx = 2 * 8 + 2;

		city.zoning[idx] = ZONE_RESIDENTIAL;
		city.building[idx] = BUILDING_LOW;
		city.population[idx] = 10;
		city.landValue[idx] = 5;

		city.aggregates[AGG.R_DEMAND] = ABANDON_DEMAND_THRESHOLD - 100;

		processMigration(city);

		expect(city.building[idx]).toBe(BUILDING_EMPTY);
		expect(city.population[idx]).toBe(0);
	});

	it("prefers high land-value tiles for growth", () => {
		const city = smallCity();

		// Two R tiles, one with high value, one low
		city.roads[2 * 8 + 3] = 1; // road between them
		city.zoning[2 * 8 + 2] = ZONE_RESIDENTIAL;
		city.zoning[2 * 8 + 4] = ZONE_RESIDENTIAL;
		city.landValue[2 * 8 + 2] = 100; // high
		city.landValue[2 * 8 + 4] = 5; // low

		// Set demand to allow just 1 build
		city.aggregates[AGG.R_DEMAND] = GROWTH_DEMAND_THRESHOLD + 10;

		processMigration(city);

		// High-value tile should build first
		expect(city.building[2 * 8 + 2]).toBe(BUILDING_LOW);
	});

	it("requires road access for growth", () => {
		const city = smallCity();

		// R tile with no road nearby
		city.zoning[0] = ZONE_RESIDENTIAL;
		city.landValue[0] = 100;
		city.aggregates[AGG.R_DEMAND] = GROWTH_DEMAND_THRESHOLD + 500;

		processMigration(city);

		expect(city.building[0]).toBe(BUILDING_EMPTY);
	});

	it("handles C and I zones independently", () => {
		const city = smallCity();

		city.roads[3 * 8 + 3] = 1;

		// C tile adjacent to road
		city.zoning[3 * 8 + 2] = ZONE_COMMERCIAL;
		city.landValue[3 * 8 + 2] = 30;

		// I tile adjacent to road
		city.zoning[3 * 8 + 4] = ZONE_INDUSTRIAL;
		city.landValue[3 * 8 + 4] = 20;

		city.aggregates[AGG.C_DEMAND] = GROWTH_DEMAND_THRESHOLD + 200;
		city.aggregates[AGG.I_DEMAND] = GROWTH_DEMAND_THRESHOLD + 200;

		processMigration(city);

		expect(city.building[3 * 8 + 2]).toBe(BUILDING_LOW);
		expect(city.building[3 * 8 + 4]).toBe(BUILDING_LOW);
		expect(city.jobs[3 * 8 + 2]).toBeGreaterThan(0);
		expect(city.jobs[3 * 8 + 4]).toBeGreaterThan(0);
	});
});
