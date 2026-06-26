import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import type { Command } from "../commands.ts";
import {
	AGG,
	BUILDING_EMPTY,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { processCommands } from "./command-processor.ts";

function smallCity() {
	return createCity({ width: 8, height: 8, seed: 1 });
}

describe("processCommands", () => {
	it("zones a tile", () => {
		const city = smallCity();
		const cmds: Command[] = [
			{ kind: "zone", x: 3, y: 4, zoneType: ZONE_RESIDENTIAL },
		];

		processCommands(city, cmds);

		const idx = 4 * 8 + 3;
		expect(city.zoning[idx]).toBe(ZONE_RESIDENTIAL);
	});

	it("does not zone water tiles", () => {
		const city = smallCity();
		const idx = 2 * 8 + 1;
		city.terrain[idx] = TERRAIN_WATER;

		processCommands(city, [
			{ kind: "zone", x: 1, y: 2, zoneType: ZONE_COMMERCIAL },
		]);

		expect(city.zoning[idx]).toBe(ZONE_NONE);
	});

	it("builds a road and clears zone", () => {
		const city = smallCity();
		const idx = 3 * 8 + 2;
		city.zoning[idx] = ZONE_RESIDENTIAL;

		processCommands(city, [{ kind: "build-road", x: 2, y: 3 }]);

		expect(city.roads[idx]).toBe(1);
		expect(city.zoning[idx]).toBe(ZONE_NONE);
	});

	it("demolishes road and building", () => {
		const city = smallCity();
		const idx = 1 * 8 + 1;
		city.roads[idx] = 1;
		city.zoning[idx] = ZONE_INDUSTRIAL;

		processCommands(city, [{ kind: "demolish", x: 1, y: 1 }]);

		expect(city.roads[idx]).toBe(0);
		expect(city.zoning[idx]).toBe(ZONE_NONE);
		expect(city.building[idx]).toBe(BUILDING_EMPTY);
	});

	it("sets tax rate clamped to 0-20%", () => {
		const city = smallCity();

		processCommands(city, [
			{ kind: "set-tax-rate", sector: "r", rate: 0.15 },
			{ kind: "set-tax-rate", sector: "c", rate: -0.05 },
			{ kind: "set-tax-rate", sector: "i", rate: 0.99 },
		]);

		expect(city.aggregates[AGG.TAX_RATE_R]).toBeCloseTo(0.15);
		expect(city.aggregates[AGG.TAX_RATE_C]).toBe(0);
		expect(city.aggregates[AGG.TAX_RATE_I]).toBeCloseTo(0.2);
	});

	it("ignores out-of-bounds zone commands", () => {
		const city = smallCity();

		processCommands(city, [
			{ kind: "zone", x: -1, y: 0, zoneType: ZONE_RESIDENTIAL },
			{ kind: "zone", x: 100, y: 0, zoneType: ZONE_RESIDENTIAL },
		]);

		// Should not throw, no tiles changed
		expect(city.zoning.every((v) => v === 0)).toBe(true);
	});

	it("cannot zone on a road", () => {
		const city = smallCity();
		const idx = 0;
		city.roads[idx] = 1;

		processCommands(city, [
			{ kind: "zone", x: 0, y: 0, zoneType: ZONE_RESIDENTIAL },
		]);

		expect(city.zoning[idx]).toBe(ZONE_NONE);
	});
});
