import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	clearCoverage,
	floodCoverage,
	type NetworkSpec,
} from "./utility-network.ts";

/**
 * Direct tests for the shared capacity-limited BFS. The spec used here is
 * deliberately simple: roads conduct, and a tile's demand is its `building`
 * value — so the walk order and the capacity frontier can be pinned exactly.
 * power.test.ts and water.test.ts cover the real specs end to end.
 */

const ROAD_NETWORK: NetworkSpec = {
	conducts: (state, idx) => state.roads[idx] === 1,
	demandAt: (state, idx) => state.building[idx] ?? 0,
};

function seedsOf(...indices: number[]): Uint32Array {
	const seeds = new Uint32Array(indices.length);
	for (let i = 0; i < indices.length; i++) {
		seeds[i] = indices[i] ?? 0;
	}
	return seeds;
}

describe("floodCoverage", () => {
	it("serves nearest-first along the network until capacity runs out", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		// A road line at y0: indices 0..9, each drawing 1.
		for (let x = 0; x < 10; x++) {
			city.roads[x] = 1;
			city.building[x] = 1;
		}

		const served = floodCoverage(
			city,
			seedsOf(0),
			1,
			ROAD_NETWORK,
			5,
			city.power,
		);

		expect(served).toBe(5);
		for (let x = 0; x < 10; x++) {
			expect(city.power[x]).toBe(x < 5 ? 1 : 0);
		}
	});

	it("stops at the first unaffordable tile, keeping coverage contiguous", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		for (let x = 0; x < 10; x++) {
			city.roads[x] = 1;
			city.building[x] = 1;
		}
		city.building[3] = 10; // a big consumer mid-line

		const served = floodCoverage(
			city,
			seedsOf(0),
			1,
			ROAD_NETWORK,
			5,
			city.power,
		);

		// Tiles 0..2 fit (3 units); tile 3 wants 10 > 2 remaining -> the walk
		// stops entirely. Tile 4 would fit but must NOT be served: no islands
		// of supply beyond the frontier.
		expect(served).toBe(3);
		expect(city.power[2]).toBe(1);
		expect(city.power[3]).toBe(0);
		expect(city.power[4]).toBe(0);
	});

	it("always serves the seed, even when the seed tile does not conduct", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		const plant = 5 * 16 + 5; // no road on the plant itself
		city.building[plant] = 2;
		city.roads[plant + 1] = 1; // road east of the plant
		city.building[plant + 1] = 1;

		const served = floodCoverage(
			city,
			seedsOf(plant),
			1,
			ROAD_NETWORK,
			10,
			city.power,
		);

		expect(city.power[plant]).toBe(1);
		expect(city.power[plant + 1]).toBe(1);
		expect(served).toBe(3);
	});

	it("does not serve a duplicated seed twice", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		const plant = 5 * 16 + 5;
		city.building[plant] = 2;

		const served = floodCoverage(
			city,
			seedsOf(plant, plant),
			2,
			ROAD_NETWORK,
			10,
			city.power,
		);

		expect(served).toBe(2);
	});

	it("resets the coverage layer on every call", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		city.power.fill(1); // stale coverage everywhere
		const plant = 5 * 16 + 5;

		const served = floodCoverage(
			city,
			seedsOf(plant),
			1,
			ROAD_NETWORK,
			10,
			city.power,
		);

		expect(served).toBe(0);
		for (let i = 0; i < city.size; i++) {
			expect(city.power[i]).toBe(i === plant ? 1 : 0);
		}
	});

	it("visits a looped network once per tile", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		// A 3x3 ring of road (8 tiles) around (5,5), each drawing 1.
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) continue;
				const i = (5 + dy) * 16 + (5 + dx);
				city.roads[i] = 1;
				city.building[i] = 1;
			}
		}
		const seed = 4 * 16 + 5; // top of the ring

		const served = floodCoverage(
			city,
			seedsOf(seed),
			1,
			ROAD_NETWORK,
			100,
			city.power,
		);

		// The ring's corners are diagonal from the seed's row, but the BFS is
		// 4-connected, so it walks around: all 8 ring tiles, 1 unit each.
		expect(served).toBe(8);
	});

	it("matches the pinned frontier on a dense road lattice", () => {
		// A 4-stride road lattice (the dense-city road shape) with 1 unit of
		// demand per road tile and capacity for 500: the BFS serves the 500
		// network-nearest tiles from the center seed. Pinned from the current
		// implementation — a changed walk order moves the frontier.
		const city = createCity({ width: 64, height: 64, seed: 1 });
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				if (x % 4 === 0 || y % 4 === 0) {
					const i = y * 64 + x;
					city.roads[i] = 1;
					city.building[i] = 1;
				}
			}
		}
		const seed = 32 * 64 + 32;

		const served = floodCoverage(
			city,
			seedsOf(seed),
			1,
			ROAD_NETWORK,
			500,
			city.power,
		);

		let covered = 0;
		for (let i = 0; i < city.size; i++) {
			covered += city.power[i] ?? 0;
		}
		expect({
			served,
			covered,
			spots: [
				city.power[32 * 64 + 32],
				city.power[32 * 64 + 44],
				city.power[20 * 64 + 32],
				city.power[0],
			],
		}).toEqual({
			served: 500,
			covered: 500,
			spots: [1, 1, 1, 0],
		});
	});
});

describe("clearCoverage", () => {
	it("zeroes the layer", () => {
		const city = createCity({ width: 8, height: 8, seed: 1 });
		city.power.fill(1);

		clearCoverage(city.power, city.size);

		for (let i = 0; i < city.size; i++) {
			expect(city.power[i]).toBe(0);
		}
	});
});
