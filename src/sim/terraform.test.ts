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
import { levelTile, setWaterTile, terraformTile } from "./terraform.ts";

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

/**
 * Every edit must leave the corner grid legal: no two orthogonally adjacent
 * vertices differ by more than 1. Levelling propagates two waves at once, so
 * this is the property worth asserting on the whole map, not just the corners
 * the test happened to name.
 */
function expectSlopeInvariant(city: CityState): void {
	for (let vy = 0; vy <= H; vy++) {
		for (let vx = 0; vx <= W; vx++) {
			const h = vh(city, vx, vy);
			if (vx < W) expect(Math.abs(h - vh(city, vx + 1, vy))).toBeLessThan(2);
			if (vy < H) expect(Math.abs(h - vh(city, vx, vy + 1))).toBeLessThan(2);
		}
	}
}

describe("levelTile", () => {
	it("raises every corner of a flat tile to the target height", () => {
		const city = makeCity();
		expect(levelTile(city, 5, 5, 2)).toBe(true);

		expect(vh(city, 5, 5)).toBe(2);
		expect(vh(city, 6, 5)).toBe(2);
		expect(vh(city, 6, 6)).toBe(2);
		expect(vh(city, 5, 6)).toBe(2);
		// The plateau grows a unit slope around it, as raising does.
		expect(vh(city, 4, 5)).toBe(1);
		expect(vh(city, 3, 5)).toBe(0);
		expect(city.elevation[5 * W + 5]).toBe(2);
		expectSlopeInvariant(city);
	});

	it("lowers a plateau and pulls its surrounding slope back down", () => {
		const city = makeCity();
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(vh(city, 4, 5)).toBe(1);

		expect(levelTile(city, 5, 5, 0)).toBe(true);
		expect(vh(city, 5, 5)).toBe(0);
		expect(vh(city, 6, 6)).toBe(0);
		// The surrounding ring is legal against the new floor, so it stays put —
		// levelling digs the tile out, it does not flatten the neighbourhood.
		// Only the second ring, which sat at 2, is dragged down.
		expect(vh(city, 4, 5)).toBe(1);
		expect(city.elevation[5 * W + 5]).toBe(0);
		expectSlopeInvariant(city);
	});

	it("drags down terrain that the new floor leaves too steep", () => {
		const city = makeCity();
		for (let i = 0; i < 4; i++) {
			expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		}
		expect(vh(city, 5, 5)).toBe(4);
		expect(vh(city, 4, 5)).toBe(3);
		expect(vh(city, 3, 5)).toBe(2);

		expect(levelTile(city, 5, 5, 1)).toBe(true);
		expect(vh(city, 5, 5)).toBe(1);
		expect(vh(city, 4, 5)).toBe(2); // pulled down from 3
		expect(vh(city, 3, 5)).toBe(2); // already legal
		expectSlopeInvariant(city);
	});

	it("flattens a tile whose corners straddle the target height", () => {
		const city = makeCity();
		// A 2-high plateau at (5, 5) leaves tile (6, 6) sloping from its shared
		// corner at 2 down to a corner still at 0 — one edit has to move corners
		// in both directions.
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		expect(vh(city, 6, 6)).toBe(2);
		expect(vh(city, 7, 7)).toBe(0);

		expect(levelTile(city, 6, 6, 1)).toBe(true);
		expect(vh(city, 6, 6)).toBe(1); // lowered
		expect(vh(city, 7, 6)).toBe(1); // already there
		expect(vh(city, 7, 7)).toBe(1); // raised
		expect(vh(city, 6, 7)).toBe(1);
		// The neighbouring plateau is legal against the new height, so it stays.
		expect(vh(city, 5, 5)).toBe(2);
		expect(city.elevation[6 * W + 6]).toBe(1);
		expectSlopeInvariant(city);
	});

	it("reports no change when the tile is already flat at the target", () => {
		const city = makeCity();
		expect(levelTile(city, 5, 5, 2)).toBe(true);
		expect(levelTile(city, 5, 5, 2)).toBe(false);
	});

	it("rejects out-of-range heights, occupied tiles, and off-map tiles", () => {
		const city = makeCity();
		expect(levelTile(city, 5, 5, -1)).toBe(false);
		expect(levelTile(city, 5, 5, ELEVATION_MAX + 1)).toBe(false);
		expect(levelTile(city, -1, 5, 1)).toBe(false);

		city.roads[7 * W + 7] = 1;
		expect(levelTile(city, 7, 7, 3)).toBe(false);
	});

	it("flattens a dragged rectangle to one plateau, tile by tile", () => {
		const city = makeCity();
		// Rolling terrain: a hill at one end of the area to be levelled.
		expect(terraformTile(city, 4, 4, CORNER_ALL, 1)).toBe(true);
		expect(terraformTile(city, 4, 4, CORNER_ALL, 1)).toBe(true);

		for (let y = 4; y <= 6; y++) {
			for (let x = 4; x <= 6; x++) {
				levelTile(city, x, y, 1);
			}
		}

		// Every vertex inside the levelled rectangle sits at the target height.
		for (let vy = 4; vy <= 7; vy++) {
			for (let vx = 4; vx <= 7; vx++) {
				expect(vh(city, vx, vy)).toBe(1);
			}
		}
		expectSlopeInvariant(city);
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

	it("charges COST_TERRAFORM per tile a level-terrain drag changes", () => {
		const city = makeCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		// Three tiles, but the middle one is already flat at the target height.
		expect(terraformTile(city, 5, 5, CORNER_ALL, 1)).toBe(true);
		const afterRaise = city.aggregates[AGG.TREASURY] ?? 0;
		expect(afterRaise).toBe(before);

		processCommands(city, [
			{ kind: "level-terrain", x: 5, y: 5, level: 1 },
			{ kind: "level-terrain", x: 6, y: 5, level: 1 },
			{ kind: "level-terrain", x: 7, y: 5, level: 1 },
		]);

		expect(vh(city, 8, 5)).toBe(1);
		// (5, 5) was already flat at 1 — only the other two are billed.
		expect(city.aggregates[AGG.TREASURY]).toBe(before - 2 * COST_TERRAFORM);
	});

	it("charges COST_PLACE_WATER when flooding succeeds", () => {
		const city = makeCity();
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		processCommands(city, [{ kind: "set-water", x: 5, y: 5, place: true }]);
		expect(city.terrain[5 * W + 5]).toBe(TERRAIN_WATER);
		expect(city.aggregates[AGG.TREASURY]).toBe(before - COST_PLACE_WATER);
	});
});
