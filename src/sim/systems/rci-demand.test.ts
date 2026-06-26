import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	BUILDING_LOW,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateRciDemand } from "./rci-demand.ts";

function smallCity() {
	return createCity({ width: 8, height: 8, seed: 1 });
}

describe("updateRciDemand", () => {
	it("produces positive I demand on an empty city (base demand)", () => {
		const city = smallCity();

		updateRciDemand(city);

		// Industrial has a base external demand, so even with no population
		// it should be positive
		const iDemand = city.aggregates[AGG.I_DEMAND] ?? 0;
		expect(iDemand).toBeGreaterThan(0);
	});

	it("produces positive R demand when jobs exist", () => {
		const city = smallCity();

		// Place some industrial buildings (creates jobs)
		for (let i = 0; i < 5; i++) {
			const idx = i;
			city.zoning[idx] = ZONE_INDUSTRIAL;
			city.building[idx] = BUILDING_LOW;
		}

		// Run demand several ticks to let it build up
		for (let t = 0; t < 10; t++) {
			updateRciDemand(city);
		}

		const rDemand = city.aggregates[AGG.R_DEMAND] ?? 0;
		expect(rDemand).toBeGreaterThan(0);
	});

	it("produces positive C demand when population exists", () => {
		const city = smallCity();

		// Place residential buildings (creates population)
		for (let i = 0; i < 10; i++) {
			const idx = i;
			city.zoning[idx] = ZONE_RESIDENTIAL;
			city.building[idx] = BUILDING_LOW;
		}

		// Run demand several ticks
		for (let t = 0; t < 10; t++) {
			updateRciDemand(city);
		}

		const cDemand = city.aggregates[AGG.C_DEMAND] ?? 0;
		expect(cDemand).toBeGreaterThan(0);
	});

	it("high taxes suppress demand", () => {
		const city = smallCity();

		// Place some industrial (creates jobs → R demand)
		for (let i = 0; i < 5; i++) {
			city.zoning[i] = ZONE_INDUSTRIAL;
			city.building[i] = BUILDING_LOW;
		}

		// Normal taxes
		for (let t = 0; t < 20; t++) {
			updateRciDemand(city);
		}
		const normalRDemand = city.aggregates[AGG.R_DEMAND] ?? 0;

		// Now raise R tax to max
		const city2 = smallCity();
		for (let i = 0; i < 5; i++) {
			city2.zoning[i] = ZONE_INDUSTRIAL;
			city2.building[i] = BUILDING_LOW;
		}
		city2.aggregates[AGG.TAX_RATE_R] = 0.2;
		for (let t = 0; t < 20; t++) {
			updateRciDemand(city2);
		}
		const highTaxRDemand = city2.aggregates[AGG.R_DEMAND] ?? 0;

		expect(highTaxRDemand).toBeLessThan(normalRDemand);
	});

	it("updates population and job totals", () => {
		const city = smallCity();

		city.zoning[0] = ZONE_RESIDENTIAL;
		city.building[0] = BUILDING_LOW;
		city.zoning[1] = ZONE_COMMERCIAL;
		city.building[1] = BUILDING_LOW;
		city.zoning[2] = ZONE_INDUSTRIAL;
		city.building[2] = BUILDING_LOW;

		updateRciDemand(city);

		expect(city.aggregates[AGG.TOTAL_POP]).toBeGreaterThan(0);
		expect(city.aggregates[AGG.TOTAL_C_JOBS]).toBeGreaterThan(0);
		expect(city.aggregates[AGG.TOTAL_I_JOBS]).toBeGreaterThan(0);
	});

	it("is deterministic across runs", () => {
		function runSimulation() {
			const city = smallCity();
			for (let i = 0; i < 5; i++) {
				city.zoning[i] = ZONE_INDUSTRIAL;
				city.building[i] = BUILDING_LOW;
			}
			for (let t = 0; t < 50; t++) {
				updateRciDemand(city);
			}
			return {
				r: city.aggregates[AGG.R_DEMAND],
				c: city.aggregates[AGG.C_DEMAND],
				i: city.aggregates[AGG.I_DEMAND],
			};
		}

		const a = runSimulation();
		const b = runSimulation();

		expect(a.r).toBe(b.r);
		expect(a.c).toBe(b.c);
		expect(a.i).toBe(b.i);
	});
});
