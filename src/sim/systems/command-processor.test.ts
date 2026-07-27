import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import type { Command } from "../commands.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_COAL_PLANT,
	COST_WATER_PIPE,
	DENSITY_LOW,
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

describe("processCommands change reporting", () => {
	it("counts only the commands that changed the city", () => {
		const city = smallCity();

		expect(processCommands(city, [{ kind: "build-road", x: 1, y: 1 }])).toBe(1);
		// The same road again is a no-op, and so is bulldozing bare land.
		expect(
			processCommands(city, [
				{ kind: "build-road", x: 1, y: 1 },
				{ kind: "demolish", x: 5, y: 5 },
			]),
		).toBe(0);
	});

	it("does not bill a bulldozer dragged across bare land", () => {
		const city = smallCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [
			{ kind: "demolish", x: 5, y: 5 },
			{ kind: "demolish", x: 6, y: 5 },
		]);

		expect(city.aggregates[AGG.TREASURY]).toBe(before);
	});

	it("re-zoning to the same type and density changes nothing", () => {
		const city = smallCity();
		const zone: Command = {
			kind: "zone",
			x: 3,
			y: 3,
			zoneType: ZONE_RESIDENTIAL,
			density: DENSITY_LOW,
		};

		expect(processCommands(city, [zone])).toBe(1);
		expect(processCommands(city, [zone])).toBe(0);
	});
});

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

describe("processCommands — water pipes", () => {
	const idx = (x: number, y: number) => y * 8 + x;

	it("lays a pipe and charges for it", () => {
		const city = smallCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [{ kind: "build-water-pipe", x: 3, y: 3 }]);

		expect(city.waterPipes[idx(3, 3)]).toBe(1);
		expect(city.aggregates[AGG.TREASURY]).toBeCloseTo(before - COST_WATER_PIPE);
	});

	it("does not lay a pipe on water terrain", () => {
		const city = smallCity();
		city.terrain[idx(2, 2)] = TERRAIN_WATER;

		processCommands(city, [{ kind: "build-water-pipe", x: 2, y: 2 }]);

		expect(city.waterPipes[idx(2, 2)]).toBe(0);
	});

	it("does not charge twice for a pipe already there", () => {
		const city = smallCity();
		processCommands(city, [{ kind: "build-water-pipe", x: 3, y: 3 }]);
		const after = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [{ kind: "build-water-pipe", x: 3, y: 3 }]);

		expect(city.aggregates[AGG.TREASURY]).toBe(after);
	});

	it("does not lay a pipe the city cannot afford", () => {
		const city = smallCity();
		city.aggregates[AGG.TREASURY] = COST_WATER_PIPE - 1;

		processCommands(city, [{ kind: "build-water-pipe", x: 3, y: 3 }]);

		expect(city.waterPipes[idx(3, 3)]).toBe(0);
	});

	it("ignores out-of-bounds pipe commands", () => {
		const city = smallCity();

		processCommands(city, [
			{ kind: "build-water-pipe", x: -1, y: 0 },
			{ kind: "build-water-pipe", x: 100, y: 0 },
		]);

		expect(city.waterPipes.every((v) => v === 0)).toBe(true);
	});

	it("demolish-pipe removes the pipe and leaves the surface alone", () => {
		const city = smallCity();
		processCommands(city, [
			{ kind: "build-water-pipe", x: 4, y: 4 },
			{ kind: "build-road", x: 4, y: 4 },
		]);

		processCommands(city, [{ kind: "demolish-pipe", x: 4, y: 4 }]);

		expect(city.waterPipes[idx(4, 4)]).toBe(0);
		expect(city.roads[idx(4, 4)]).toBe(1);
	});

	it("demolish-pipe on a tile with no pipe costs nothing", () => {
		const city = smallCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [{ kind: "demolish-pipe", x: 5, y: 5 }]);

		expect(city.aggregates[AGG.TREASURY]).toBe(before);
	});
});

describe("processCommands — underground layers survive surface work", () => {
	const idx = (x: number, y: number) => y * 8 + x;

	// Pipes sit below the surface, so building over them must not disturb them.
	// Metros and tunnels will land on the same rule; clearTile must stay
	// surface-only.
	const surfaceBuilds: ReadonlyArray<{ label: string; cmd: Command }> = [
		{ label: "a road", cmd: { kind: "build-road", x: 4, y: 4 } },
		{ label: "rail", cmd: { kind: "build-rail", x: 4, y: 4 } },
		{ label: "a power line", cmd: { kind: "build-power-line", x: 4, y: 4 } },
		{
			label: "a civic building",
			cmd: { kind: "place-civic", x: 4, y: 4, civicType: CIVIC_COAL_PLANT },
		},
	];

	for (const { label, cmd } of surfaceBuilds) {
		it(`keeps the pipe when ${label} is built over it`, () => {
			const city = smallCity();
			processCommands(city, [{ kind: "build-water-pipe", x: 4, y: 4 }]);

			processCommands(city, [cmd]);

			expect(city.waterPipes[idx(4, 4)]).toBe(1);
		});
	}

	it("keeps the pipe when the surface is demolished", () => {
		const city = smallCity();
		processCommands(city, [
			{ kind: "build-water-pipe", x: 4, y: 4 },
			{ kind: "build-road", x: 4, y: 4 },
		]);

		processCommands(city, [{ kind: "demolish", x: 4, y: 4 }]);

		expect(city.roads[idx(4, 4)]).toBe(0);
		expect(city.waterPipes[idx(4, 4)]).toBe(1);
	});

	it("destroys the pipe when the tile is flooded", () => {
		const city = smallCity();
		processCommands(city, [{ kind: "build-water-pipe", x: 4, y: 4 }]);

		processCommands(city, [{ kind: "set-water", x: 4, y: 4, place: true }]);

		expect(city.terrain[idx(4, 4)]).toBe(TERRAIN_WATER);
		expect(city.waterPipes[idx(4, 4)]).toBe(0);
	});
});
