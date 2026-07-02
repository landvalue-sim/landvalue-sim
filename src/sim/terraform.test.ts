import { describe, expect, it } from "vitest";
import { type CityState, createCity, vertexIndex } from "./city-state.ts";
import {
	AGG,
	CORNER_ALL,
	CORNER_E,
	CORNER_N,
	CORNER_S,
	CORNER_W,
	COST_PLACE_WATER,
	COST_TERRAFORM,
	ELEVATION_MAX,
	TERRAIN_LAND,
	TERRAIN_WATER,
} from "./constants.ts";
import { processCommands } from "./systems/command-processor.ts";
import { setWaterTile, terraformTile } from "./terraform.ts";

const W = 16;
const H = 16;

function makeCity(): CityState {
	return createCity({ width: W, height: H, seed: 1 });
}

function vh(city: CityState, vx: number, vy: number): number {
	return city.vertexHeights[vertexIndex(W, vx, vy)] ?? 0;
}

describe("terraformTile", () => {
	it("raises a flat tile by lifting all four corners", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);

		expect(vh(city, 5, 5)).toBe(1);
		expect(vh(city, 6, 5)).toBe(1);
		expect(vh(city, 6, 6)).toBe(1);
		expect(vh(city, 5, 6)).toBe(1);
		// Derived per-tile elevation is the min corner.
		expect(city.elevation[5 * W + 5]).toBe(1);
		// Height 1 next to height 0 satisfies the slope limit — no spread.
		expect(vh(city, 4, 5)).toBe(0);
	});

	it("flattens a sloped tile up to its highest corner", () => {
		const city = makeCity();
		city.vertexHeights[vertexIndex(W, 5, 5)] = 1; // one raised corner

		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(vh(city, 5, 5)).toBe(1);
		expect(vh(city, 6, 5)).toBe(1);
		expect(vh(city, 6, 6)).toBe(1);
		expect(vh(city, 5, 6)).toBe(1);
	});

	it("propagates the slope limit outward when raising a plateau", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);

		// Corners at 2 force the surrounding ring of vertices up to 1.
		expect(vh(city, 5, 5)).toBe(2);
		expect(vh(city, 4, 5)).toBe(1);
		expect(vh(city, 5, 4)).toBe(1);
		expect(vh(city, 7, 6)).toBe(1);
		expect(vh(city, 6, 7)).toBe(1);
		// Two steps out is unaffected.
		expect(vh(city, 3, 5)).toBe(0);
		// Neighbor tiles turned into slopes: derived elevation is their min.
		expect(city.elevation[5 * W + 4]).toBe(1);
		expect(city.elevation[4 * W + 3]).toBe(0);
	});

	it("raises a single corner without moving the others", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_N, 1)).toBe(true);

		expect(vh(city, 5, 5)).toBe(1);
		expect(vh(city, 6, 5)).toBe(0);
		expect(vh(city, 6, 6)).toBe(0);
		expect(vh(city, 5, 6)).toBe(0);
		// Min corner unchanged, so derived elevation stays 0.
		expect(city.elevation[5 * W + 5]).toBe(0);
	});

	it("maps each corner constant to the right vertex", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_E, 1)).toBe(true);
		expect(vh(city, 6, 5)).toBe(1);
		expect(terraformTile(city, 8, 8, CORNER_S, 1)).toBe(true);
		expect(vh(city, 9, 9)).toBe(1);
		expect(terraformTile(city, 11, 11, CORNER_W, 1)).toBe(true);
		expect(vh(city, 11, 12)).toBe(1);
	});

	it("lowers a flat tile and clamps at 0", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(terraformTile(city, 5, 5, CORNER_ALL, -1)).toBe(true);
		expect(vh(city, 5, 5)).toBe(0);
		// Already at 0 — lowering further is a no-op.
		expect(terraformTile(city, 5, 5, CORNER_ALL, -1)).toBe(false);
	});

	it("flattens a sloped tile down to its lowest corner when lowering", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_N, 1)).toBe(true);
		expect(terraformTile(city, 5, 5, CORNER_ALL, -1)).toBe(true);
		expect(vh(city, 5, 5)).toBe(0);
		expect(vh(city, 6, 6)).toBe(0);
	});

	it("clamps raising at ELEVATION_MAX", () => {
		const city = makeCity();
		city.vertexHeights.fill(ELEVATION_MAX);
		// Rebuild the derived elevation the fill bypassed.
		city.elevation.fill(ELEVATION_MAX);
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(false);
		expect(terraformTile(city, 5, 5, CORNER_N, 1)).toBe(false);
	});

	it("rejects occupied tiles and bad arguments", () => {
		const city = makeCity();
		city.roads[5 * W + 5] = 1;
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(false);
		expect(terraformTile(city, -1, 5, CORNER_ALL, 1)).toBe(false);
		expect(terraformTile(city, 5, 5, 7, 1)).toBe(false);
		expect(terraformTile(city, 6, 6, CORNER_ALL, 2)).toBe(false);
	});

	it("reclaims water as land when raised above its surface", () => {
		const city = makeCity();
		expect(setWaterTile(city, 5, 5, true)).toBe(true);
		expect(city.terrain[5 * W + 5]).toBe(TERRAIN_WATER);

		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(city.terrain[5 * W + 5]).toBe(TERRAIN_LAND);
		expect(city.waterLevel[5 * W + 5]).toBe(0);
	});
});

describe("setWaterTile", () => {
	it("floods a tile at its highest corner and clears zoning", () => {
		const city = makeCity();
		const idx = 5 * W + 5;
		city.vertexHeights[vertexIndex(W, 6, 6)] = 1; // sloped shore corner
		city.zoning[idx] = 1;
		city.densityCap[idx] = 1;

		expect(setWaterTile(city, 5, 5, true)).toBe(true);
		expect(city.terrain[idx]).toBe(TERRAIN_WATER);
		expect(city.waterLevel[idx]).toBe(1);
		expect(city.zoning[idx]).toBe(0);
		expect(city.densityCap[idx]).toBe(0);
	});

	it("drains water back to land", () => {
		const city = makeCity();
		const idx = 5 * W + 5;
		expect(setWaterTile(city, 5, 5, true)).toBe(true);
		expect(setWaterTile(city, 5, 5, false)).toBe(true);
		expect(city.terrain[idx]).toBe(TERRAIN_LAND);
		expect(city.waterLevel[idx]).toBe(0);
	});

	it("rejects double-flooding, occupied tiles, and draining dry land", () => {
		const city = makeCity();
		expect(setWaterTile(city, 5, 5, true)).toBe(true);
		expect(setWaterTile(city, 5, 5, true)).toBe(false);
		expect(setWaterTile(city, 6, 6, false)).toBe(false);
		city.roads[7 * W + 7] = 1;
		expect(setWaterTile(city, 7, 7, true)).toBe(false);
	});
});

describe("terraform commands", () => {
	it("charges COST_TERRAFORM only when the edit succeeds", () => {
		const city = makeCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [
			{ kind: "terraform", x: 5, y: 5, corner: CORNER_ALL, dir: 1 },
		]);
		expect(city.aggregates[AGG.TREASURY]).toBe(before - COST_TERRAFORM);

		// Lowering below 0 fails and must not charge.
		processCommands(city, [
			{ kind: "terraform", x: 10, y: 10, corner: CORNER_ALL, dir: -1 },
		]);
		expect(city.aggregates[AGG.TREASURY]).toBe(before - COST_TERRAFORM);
	});

	it("charges COST_PLACE_WATER when flooding succeeds", () => {
		const city = makeCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [{ kind: "set-water", x: 5, y: 5, place: true }]);
		expect(city.terrain[5 * W + 5]).toBe(TERRAIN_WATER);
		expect(city.aggregates[AGG.TREASURY]).toBe(before - COST_PLACE_WATER);
	});
});
