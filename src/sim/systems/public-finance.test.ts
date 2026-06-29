import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_LOW,
	ROAD_MAINTENANCE_COST,
	SERVICE_COST_PER_POP,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updatePublicFinance } from "./public-finance.ts";
import { updateRciDemand } from "./rci-demand.ts";

function smallCity() {
	return createCity({ width: 8, height: 8, seed: 1 });
}

describe("updatePublicFinance", () => {
	it("collects tax revenue from occupied tiles", () => {
		const city = smallCity();
		const idx = 0;

		city.zoning[idx] = ZONE_RESIDENTIAL;
		city.building[idx] = BUILDING_LOW;
		city.landValue[idx] = 100;

		// Ensure totals are computed
		updateRciDemand(city);
		const treasuryBefore = city.aggregates[AGG.TREASURY] ?? 0;

		updatePublicFinance(city);

		const treasuryAfter = city.aggregates[AGG.TREASURY] ?? 0;
		// Should have increased from tax revenue (minus service costs)
		// Revenue = 100 * 0.07 = 7
		expect(treasuryAfter).not.toBe(treasuryBefore);
	});

	it("deducts road maintenance", () => {
		const city = smallCity();

		// Add some roads
		for (let i = 0; i < 10; i++) {
			city.roads[i] = 1;
		}

		const before = city.aggregates[AGG.TREASURY] ?? 0;
		updatePublicFinance(city);
		const after = city.aggregates[AGG.TREASURY] ?? 0;

		// With no buildings (no revenue) and roads (maintenance cost), treasury should decrease
		const expectedCost = 10 * ROAD_MAINTENANCE_COST;
		expect(after).toBeCloseTo(before - expectedCost);
	});

	it("treasury can go negative (debt)", () => {
		const city = smallCity();
		city.aggregates[AGG.TREASURY] = 0;

		// Add road costs with no revenue
		for (let i = 0; i < 20; i++) {
			city.roads[i] = 1;
		}

		updatePublicFinance(city);

		expect(city.aggregates[AGG.TREASURY]).toBeLessThan(0);
	});

	it("records the per-tick budget breakdown in aggregates", () => {
		const city = smallCity();
		city.zoning[0] = ZONE_RESIDENTIAL;
		city.building[0] = BUILDING_LOW;
		city.landValue[0] = 100;
		for (let i = 1; i < 6; i++) city.roads[i] = 1;
		updateRciDemand(city);

		updatePublicFinance(city);

		// Revenue = landValue(100) * taxR(0.07) = 7
		expect(city.aggregates[AGG.REVENUE]).toBeCloseTo(7);
		// Service cost = pop(10) * SERVICE_COST_PER_POP
		expect(city.aggregates[AGG.SERVICE_COST]).toBeCloseTo(
			10 * SERVICE_COST_PER_POP,
		);
		// Road cost = 5 roads * ROAD_MAINTENANCE_COST
		expect(city.aggregates[AGG.ROAD_COST]).toBeCloseTo(
			5 * ROAD_MAINTENANCE_COST,
		);
	});

	it("higher tax rate produces more revenue", () => {
		function runWithTax(rate: number): number {
			const city = smallCity();
			city.aggregates[AGG.TAX_RATE_R] = rate;
			city.zoning[0] = ZONE_RESIDENTIAL;
			city.building[0] = BUILDING_LOW;
			city.landValue[0] = 100;
			updateRciDemand(city);
			city.aggregates[AGG.TREASURY] = 0;
			updatePublicFinance(city);
			return city.aggregates[AGG.TREASURY] ?? 0;
		}

		const lowTax = runWithTax(0.05);
		const highTax = runWithTax(0.15);

		expect(highTax).toBeGreaterThan(lowTax);
	});
});
