import { describe, expect, it } from "vitest";
import { type CityState, createCity } from "../sim/city-state.ts";
import { TERRAIN_WATER } from "../sim/constants.ts";
import { ELEV_HEIGHT, HALF_H, HALF_W } from "./iso.ts";
import { pickTile, tileSurfaceHeight } from "./picking.ts";

const W = 16;
const H = 16;

/**
 * World-space point over the surface of tile (x, y) at in-tile fraction
 * (fx, fy), where the surface sits at height `s` (in corner-height units).
 */
function surfacePoint(
	x: number,
	y: number,
	fx: number,
	fy: number,
	s: number,
): { sx: number; sy: number } {
	const gx = x + fx;
	const gy = y + fy;
	return {
		sx: (gx - gy) * HALF_W,
		sy: (gx + gy) * HALF_H - s * ELEV_HEIGHT,
	};
}

/**
 * Terrain sloping down along +x from a height-6 plateau: vertices at
 * vx <= 2 sit at 6, then step down one per column to 0 at vx >= 8.
 * Tile x=2 slopes 6 -> 5, x=3 slopes 5 -> 4, ..., uniform along y.
 */
function slopeCity(): CityState {
	const city = createCity({ width: W, height: H, seed: 1 });
	const vw = W + 1;
	for (let vy = 0; vy <= H; vy++) {
		for (let vx = 0; vx <= W; vx++) {
			const height = Math.max(0, Math.min(6, 8 - vx));
			city.vertexHeights[vy * vw + vx] = height;
		}
	}
	return city;
}

describe("pickTile", () => {
	it("picks the tile under the cursor on flat ground", () => {
		const city = createCity({ width: W, height: H, seed: 1 });
		const p = surfacePoint(5, 5, 0.5, 0.5, 0);
		const pick = pickTile(city, p.sx, p.sy);
		expect({ x: pick.x, y: pick.y }).toEqual({ x: 5, y: 5 });
		expect(pick.fx).toBeCloseTo(0.5, 2);
		expect(pick.fy).toBeCloseTo(0.5, 2);
	});

	it("picks an elevated tile through its lifted surface", () => {
		const city = createCity({ width: W, height: H, seed: 1 });
		city.vertexHeights.fill(4);
		const p = surfacePoint(5, 5, 0.5, 0.5, 4);
		const pick = pickTile(city, p.sx, p.sy);
		expect({ x: pick.x, y: pick.y }).toEqual({ x: 5, y: 5 });
	});

	it("picks the slope tile when hovering its downhill half at a high/low edge", () => {
		// Regression: hovering near the edge between a higher and lower tile used
		// to fall through every elevation-plane probe (the sloped surface never
		// equals its tile's max corner) and select the tile whose *base* plane
		// sits under the cursor — tiles away from the visible surface.
		const city = slopeCity();
		// Tile (2, 4) slopes 6 -> 5; at fraction (0.9, 0.5) the surface is 5.1.
		const p = surfacePoint(2, 4, 0.9, 0.5, 5.1);
		const pick = pickTile(city, p.sx, p.sy);
		expect({ x: pick.x, y: pick.y }).toEqual({ x: 2, y: 4 });
		expect(pick.fx).toBeCloseTo(0.9, 2);
		expect(pick.fy).toBeCloseTo(0.5, 2);
	});

	it("picks the lower slope tile when hovering just past the shared edge", () => {
		// The mirror case: cursor on the uphill sliver of the next tile down.
		// A probe plane below the cursor lands inside the higher neighbor, so a
		// naive "surface >= plane" acceptance would grab that neighbor; the
		// bisection refinement must resolve to the true crossing instead.
		const city = slopeCity();
		// Tile (3, 4) slopes 5 -> 4; at fraction (0.1, 0.5) the surface is 4.9.
		const p = surfacePoint(3, 4, 0.1, 0.5, 4.9);
		const pick = pickTile(city, p.sx, p.sy);
		expect({ x: pick.x, y: pick.y }).toEqual({ x: 3, y: 4 });
		expect(pick.fx).toBeCloseTo(0.1, 2);
	});

	it("picks a water tile through its flat plane", () => {
		const city = createCity({ width: W, height: H, seed: 1 });
		const idx = 5 * W + 5;
		city.terrain[idx] = TERRAIN_WATER;
		city.waterLevel[idx] = 3;
		const p = surfacePoint(5, 5, 0.5, 0.5, 3);
		const pick = pickTile(city, p.sx, p.sy);
		expect({ x: pick.x, y: pick.y }).toEqual({ x: 5, y: 5 });
	});

	it("falls back to the ground plane beyond the map edge", () => {
		const city = createCity({ width: W, height: H, seed: 1 });
		const p = surfacePoint(-3, -3, 0.5, 0.5, 0);
		const pick = pickTile(city, p.sx, p.sy);
		expect({ x: pick.x, y: pick.y }).toEqual({ x: -3, y: -3 });
	});
});

describe("tileSurfaceHeight", () => {
	it("returns the highest corner for land and the water level for water", () => {
		const city = slopeCity();
		expect(tileSurfaceHeight(city, 1, 4)).toBe(6); // flat plateau
		expect(tileSurfaceHeight(city, 2, 4)).toBe(6); // slope 6 -> 5
		expect(tileSurfaceHeight(city, 9, 4)).toBe(0); // flat plain
		const idx = 12 * W + 12;
		city.terrain[idx] = TERRAIN_WATER;
		city.waterLevel[idx] = 2;
		expect(tileSurfaceHeight(city, 12, 12)).toBe(2);
	});
});
