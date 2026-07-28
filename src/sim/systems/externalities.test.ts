import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	BUILDING_HIGH,
	BUILDING_LOW,
	CIVIC_COAL_PLANT,
	MAX_POLLUTION,
	POLLUTION_PER_INDUSTRIAL,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
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

	it("road traffic adds pollution on the road tile", () => {
		const city = smallCity();
		const idx = 4 * 8 + 4;
		city.roads[idx] = 1;
		city.traffic[idx] = 10;

		updateExternalities(city);

		// floor(10 * TRAFFIC_POLLUTION_FACTOR) with the current factor of 0.3.
		expect(city.pollution[idx]).toBe(3);
	});

	it("spreads exact decayed values from a corner source, square-clipped", () => {
		// Hand-derived from floor(25 * 0.6^d): d=0..6 -> 25, 15, 9, 5, 3, 1, 1.
		// The spread window is the square |dx|,|dy| <= 4, so (5,0) gets nothing
		// even though its Manhattan distance (5) still carries a contribution.
		const city = createCity({ width: 12, height: 12, seed: 1 });
		city.zoning[0] = ZONE_INDUSTRIAL;
		city.building[0] = BUILDING_LOW;

		updateExternalities(city);

		const at = (x: number, y: number) => city.pollution[y * 12 + x];
		expect(at(0, 0)).toBe(25);
		expect(at(1, 0)).toBe(15);
		expect(at(0, 1)).toBe(15);
		expect(at(1, 1)).toBe(9);
		expect(at(2, 0)).toBe(9);
		expect(at(3, 0)).toBe(5);
		expect(at(4, 0)).toBe(3);
		expect(at(4, 1)).toBe(1); // d=5
		expect(at(3, 3)).toBe(1); // d=6
		expect(at(4, 3)).toBe(0); // d=7 decays to zero
		expect(at(4, 4)).toBe(0); // d=8 decays to zero
		expect(at(5, 0)).toBe(0); // outside the square window
	});

	it("saturates at MAX_POLLUTION where sources stack", () => {
		// All-industrial 11x11: the center tile receives 293 before clamping
		// (25 + 60 + 72 + 60 + 48 + 16 + 12 across distances 0-6), the corner
		// only 124 — its kernel is clipped by the map edge.
		const city = createCity({ width: 11, height: 11, seed: 1 });
		for (let i = 0; i < city.size; i++) {
			city.zoning[i] = ZONE_INDUSTRIAL;
			city.building[i] = BUILDING_HIGH;
		}

		updateExternalities(city);

		expect(city.pollution[5 * 11 + 5]).toBe(MAX_POLLUTION);
		expect(city.pollution[0]).toBe(124);
		expect(city.pollution[5 * 11]).toBe(191);
	});
});

/**
 * Golden pin — expected values baked from the direct per-source scatter
 * implementation before it was optimised; an optimised updateExternalities
 * must reproduce them exactly.
 */
describe("updateExternalities golden pin", () => {
	it("matches the pinned field on a dense 64x64 grid city", () => {
		// 4-stride road lattice with traffic, blocks cycling C/R/I at high
		// density, and a coal plant per 16x16 cell — industrial spread, plant
		// spread, and traffic pollution all active.
		const city = createCity({ width: 64, height: 64, seed: 1 });
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				const i = y * 64 + x;
				if (x % 4 === 0 || y % 4 === 0) {
					city.roads[i] = 1;
					city.traffic[i] = (x + y) % 64;
					continue;
				}
				const zones = [ZONE_COMMERCIAL, ZONE_RESIDENTIAL, ZONE_INDUSTRIAL];
				city.zoning[i] = zones[Math.floor(x / 4) % 3] ?? 0;
				city.building[i] = BUILDING_HIGH;
			}
		}
		for (let cy = 0; cy + 16 <= 64; cy += 16) {
			for (let cx = 0; cx + 16 <= 64; cx += 16) {
				const i = (cy + 2) * 64 + (cx + 2);
				city.civic[i] = CIVIC_COAL_PLANT;
				city.zoning[i] = 0;
				city.building[i] = 0;
			}
		}

		updateExternalities(city);

		let sum = 0;
		let max = 0;
		let capped = 0;
		for (let i = 0; i < city.size; i++) {
			const v = city.pollution[i] ?? 0;
			sum += v;
			if (v > max) max = v;
			if (v === 255) capped++;
		}
		const spots = [
			[0, 0],
			[63, 63],
			[2, 2], // coal plant tile
			[9, 9], // industrial block interior
			[33, 17],
			[18, 2],
			[45, 45],
			[62, 1],
		].map(([x, y]) => city.pollution[(y ?? 0) * 64 + (x ?? 0)]);

		expect({ sum, max, capped, spots }).toEqual({
			sum: 225617,
			max: 155,
			capped: 0,
			spots: [2, 5, 20, 131, 129, 37, 131, 14],
		});
	});
});
