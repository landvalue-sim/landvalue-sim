import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import { AGG } from "../constants.ts";
import { updateConnections } from "./connections.ts";

/**
 * A connection is an edge tile carrying a road or rail. Every edge tile is
 * examined exactly once (corners belong to the top/bottom sweep), and a tile
 * with both road and rail still counts once.
 */

describe("updateConnections", () => {
	it("counts nothing on an empty map and clears the old count", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		city.aggregates[AGG.CONNECTION_COUNT] = 99;

		updateConnections(city);

		expect(city.aggregates[AGG.CONNECTION_COUNT]).toBe(0);
	});

	it("counts road and rail tiles on every edge, ignoring the interior", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		city.roads[3] = 1; // top edge
		city.rail[15 * 16 + 7] = 1; // bottom edge
		city.roads[5 * 16] = 1; // left edge
		city.rail[8 * 16 + 15] = 1; // right edge
		city.roads[7 * 16 + 7] = 1; // interior — not a connection

		updateConnections(city);

		expect(city.aggregates[AGG.CONNECTION_COUNT]).toBe(4);
	});

	it("counts a corner tile exactly once", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		city.roads[0] = 1; // (0,0): on both the top and left edges

		updateConnections(city);

		expect(city.aggregates[AGG.CONNECTION_COUNT]).toBe(1);
	});

	it("counts a tile with both road and rail once", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		city.roads[4] = 1;
		city.rail[4] = 1;

		updateConnections(city);

		expect(city.aggregates[AGG.CONNECTION_COUNT]).toBe(1);
	});

	it("counts a fully ringed map edge exactly once per edge tile", () => {
		const city = createCity({ width: 16, height: 16, seed: 1 });
		for (let x = 0; x < 16; x++) {
			city.roads[x] = 1;
			city.roads[15 * 16 + x] = 1;
		}
		for (let y = 0; y < 16; y++) {
			city.roads[y * 16] = 1;
			city.roads[y * 16 + 15] = 1;
		}

		updateConnections(city);

		// Perimeter of a 16x16 grid: 4 * 16 - 4 corners counted once.
		expect(city.aggregates[AGG.CONNECTION_COUNT]).toBe(60);
	});
});
