import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	BUILDING_HIGH,
	BUILDING_LOW,
	CIVIC_PARK,
	CIVIC_STADIUM,
	LV_BASE,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";
import { updateLandValue } from "./land-value.ts";

function smallCity() {
	const city = createCity({ width: 8, height: 8, seed: 1 });
	// Progressive disclosure: power/water default to covered when no plants or
	// pumps exist, but direct updateLandValue calls bypass tick, so set them.
	city.power.fill(1);
	city.waterCoverage.fill(1);
	return city;
}

describe("updateLandValue", () => {
	it("assigns base value to empty land tiles", () => {
		const city = smallCity();
		updateLandValue(city);

		// Interior tiles should have at least the base value
		const center = 4 * 8 + 4;
		expect(city.landValue[center]).toBeGreaterThanOrEqual(LV_BASE - 2);
	});

	it("assigns zero to water tiles", () => {
		const city = smallCity();
		const idx = 3 * 8 + 3;
		city.terrain[idx] = 1; // water

		updateLandValue(city);

		expect(city.landValue[idx]).toBe(0);
	});

	it("road tiles carry no parcel value; the premium goes to adjacent land", () => {
		const city = smallCity();
		const roadIdx = 4 * 8 + 4;
		const adjIdx = 4 * 8 + 3; // orthogonally adjacent to the road
		const farIdx = 0; // (0,0), away from the road
		city.roads[roadIdx] = 1;

		updateLandValue(city);

		// The roadbed itself is worth nothing — it is not a taxable parcel.
		expect(city.landValue[roadIdx]).toBe(0);
		// The access premium capitalizes into the adjacent developable land.
		expect(city.landValue[adjIdx] ?? 0).toBeGreaterThan(
			city.landValue[farIdx] ?? 0,
		);
	});

	it("tiles adjacent to roads get a bonus", () => {
		const city = smallCity();
		// Place a road at (4,4)
		city.roads[4 * 8 + 4] = 1;

		updateLandValue(city);

		// Adjacent tile (3,4) should have more value than distant tile (0,0)
		const adjValue = city.landValue[4 * 8 + 3] ?? 0;
		const farValue = city.landValue[0 * 8 + 0] ?? 0;
		expect(adjValue).toBeGreaterThan(farValue);
	});

	it("industrial neighbors reduce land value", () => {
		const city = smallCity();

		// Place R zone at (4,4), I zone at (4,5)
		const rIdx = 4 * 8 + 4;
		const iIdx = 5 * 8 + 4;
		city.zoning[rIdx] = ZONE_RESIDENTIAL;
		city.zoning[iIdx] = ZONE_INDUSTRIAL;
		city.building[iIdx] = BUILDING_LOW;

		updateLandValue(city);

		// R tile next to I should have lower value than R tile far from I
		const nearI = city.landValue[rIdx] ?? 0;

		// Compare with an isolated R tile
		const city2 = smallCity();
		city2.zoning[rIdx] = ZONE_RESIDENTIAL;
		updateLandValue(city2);
		const farFromI = city2.landValue[rIdx] ?? 0;

		expect(nearI).toBeLessThan(farFromI);
	});

	it("diffusion spreads value outward from road-adjacent parcels", () => {
		const city = smallCity();
		// A road creates a ring of high-value adjacent parcels.
		city.roads[4 * 8 + 4] = 1;

		updateLandValue(city);

		const adj = city.landValue[4 * 8 + 3] ?? 0; // touches the road (peak)
		const twoAway = city.landValue[4 * 8 + 2] ?? 0; // one tile further out
		const far = city.landValue[0 * 8 + 0] ?? 0; // corner, away from the road

		// Value decays with distance, but diffusion still carries some outward.
		expect(adj).toBeGreaterThan(twoAway);
		expect(twoAway).toBeGreaterThan(far);
	});

	it("is deterministic", () => {
		function run() {
			const city = smallCity();
			city.roads[4 * 8 + 4] = 1;
			city.zoning[3 * 8 + 3] = ZONE_RESIDENTIAL;
			city.zoning[5 * 8 + 5] = ZONE_COMMERCIAL;
			city.building[5 * 8 + 5] = BUILDING_LOW;
			updateLandValue(city);
			return Array.from(city.landValue);
		}

		expect(run()).toEqual(run());
	});

	it("a uniform empty grid settles at exactly LV_BASE everywhere", () => {
		// Hand-derived fixed point: with no amenities, penalties, or elevation,
		// every parcel's raw value is LV_BASE, and diffusion of a uniform field
		// leaves it unchanged (avg === current on every tile, borders included).
		const city = smallCity();
		updateLandValue(city);

		for (let i = 0; i < city.size; i++) {
			expect(city.landValue[i]).toBe(LV_BASE);
		}
	});
});

/**
 * Golden pins — expected values were baked from the separable implementation
 * after it was differentially verified bit-identical to the pre-optimisation
 * per-neighbor scan (randomized terrain/zoning/fields across grid shapes from
 * 1x1 to 256x256, PR #12 review). They guard the next refactor the way the
 * dense pin in traffic.test.ts guarded this one.
 */
describe("updateLandValue golden pins", () => {
	it("matches the pinned field on a dense 64x64 city with every term active", () => {
		// 4-stride road lattice, blocks alternating C/R at high density, plus a
		// lake, a rail row, a power-line column, park/stadium/generic civic,
		// unpowered and unwatered bands, and deterministic elevation, pollution,
		// crime, and road-traffic fields — so every pass-1 term participates.
		const city = createCity({ width: 64, height: 64, seed: 1 });
		city.power.fill(1);
		city.waterCoverage.fill(1);
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				const i = y * 64 + x;
				if (x % 4 === 0 || y % 4 === 0) {
					city.roads[i] = 1;
				} else {
					const commercial = Math.floor(x / 4) % 2 === 0;
					city.zoning[i] = commercial ? ZONE_COMMERCIAL : ZONE_RESIDENTIAL;
					city.building[i] = BUILDING_HIGH;
				}
				city.elevation[i] = (x * 3 + y * 5) % 256;
				city.pollution[i] = (x * 7 + y * 11) % 16;
				city.crime[i] = (x * 13 + y * 3) % 24;
				city.traffic[i] = city.roads[i] === 1 ? (x + y) % 64 : 0;
			}
		}
		for (let y = 20; y < 24; y++) {
			for (let x = 10; x < 14; x++) {
				const i = y * 64 + x;
				city.terrain[i] = TERRAIN_WATER;
				city.zoning[i] = 0;
				city.building[i] = 0;
				city.roads[i] = 0;
			}
		}
		for (let x = 0; x < 64; x++) city.rail[32 * 64 + x] = 1;
		for (let y = 0; y < 64; y++) city.powerLines[y * 64 + 17] = 1;
		city.civic[10 * 64 + 30] = CIVIC_PARK;
		city.civic[42 * 64 + 51] = CIVIC_STADIUM;
		city.civic[50 * 64 + 5] = 1; // any non-park/stadium civic building
		for (let i = 40 * 64; i < 44 * 64; i++) city.power[i] = 0;
		for (let y = 0; y < 64; y++) {
			for (let x = 50; x < 54; x++) city.waterCoverage[y * 64 + x] = 0;
		}

		updateLandValue(city);

		let sum = 0;
		let max = 0;
		let nonzero = 0;
		for (let i = 0; i < city.size; i++) {
			const v = city.landValue[i] ?? 0;
			sum += v;
			if (v > max) max = v;
			if (v > 0) nonzero++;
		}
		const spots = [
			[0, 0], // road corner — not a parcel
			[63, 0], // road corner
			[0, 63], // road corner
			[63, 63], // parcel corner
			[1, 1], // parcel clamped to zero by crime near the origin
			[62, 62],
			[30, 9], // beside the park
			[51, 41], // unpowered and unwatered
			[11, 21], // lake
			[18, 10], // beside the power-line column
			[51, 30],
			[6, 42],
			[33, 33], // beside the rail row
		].map(([x, y]) => city.landValue[(y ?? 0) * 64 + (x ?? 0)]);

		expect({ sum, max, nonzero, spots }).toEqual({
			sum: 90626,
			max: 126,
			nonzero: 2105,
			spots: [0, 0, 0, 103, 0, 91, 44, 12, 0, 30, 1, 78, 18],
		});
	});

	it("matches the pinned field on a 6x5 border-torture grid", () => {
		// Amenities pushed into every corner so the row-aggregate clamping at
		// the first/last column and row is exercised on all four edges.
		const city = createCity({ width: 6, height: 5, seed: 1 });
		city.power.fill(1);
		city.waterCoverage.fill(1);
		const at = (x: number, y: number) => y * 6 + x;
		city.roads[at(0, 0)] = 1;
		city.rail[at(5, 0)] = 1;
		city.civic[at(0, 4)] = CIVIC_PARK;
		city.civic[at(5, 4)] = CIVIC_STADIUM;
		city.terrain[at(2, 2)] = TERRAIN_WATER;
		city.zoning[at(3, 1)] = ZONE_INDUSTRIAL;
		city.building[at(3, 1)] = BUILDING_LOW;
		city.zoning[at(1, 3)] = ZONE_COMMERCIAL;
		city.building[at(1, 3)] = BUILDING_LOW;
		city.zoning[at(4, 3)] = ZONE_RESIDENTIAL;
		city.building[at(4, 3)] = BUILDING_HIGH;
		for (let i = 0; i < city.size; i++) {
			city.elevation[i] = (i * 9) % 40;
			city.crime[i] = (i * 5) % 30;
			city.traffic[i] = (i * 3) % 20;
			city.pollution[i] = (i * 2) % 10;
		}
		city.power[at(2, 0)] = 0;
		city.waterCoverage[at(3, 4)] = 0;

		updateLandValue(city);

		expect(Array.from(city.landValue)).toEqual([
			0, 6, 1, 0, 0, 0, 13, 12, 1, 0, 0, 0, 7, 6, 0, 0, 0, 0, 2, 1, 2, 0, 0, 0,
			0, 9, 0, 0, 0, 0,
		]);
	});

	it("matches the pinned field on a 1x12 strip (direct-diffusion path)", () => {
		// Degenerate width-1 map: exercises the diffuseOnceDirect fallback.
		const city = createCity({ width: 1, height: 12, seed: 1 });
		city.power.fill(1);
		city.waterCoverage.fill(1);
		city.roads[3] = 1;
		city.rail[7] = 1;
		city.civic[10] = CIVIC_PARK;
		city.zoning[5] = ZONE_RESIDENTIAL;
		city.building[5] = BUILDING_LOW;
		for (let i = 0; i < 12; i++) city.elevation[i] = i * 4;

		updateLandValue(city);

		expect(Array.from(city.landValue)).toEqual([
			11, 14, 21, 0, 27, 24, 27, 0, 34, 29, 0, 25,
		]);
	});
});
