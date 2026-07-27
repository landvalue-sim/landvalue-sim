import { describe, expect, it } from "vitest";
import { type CityState, createCity } from "./city-state.ts";
import { AGG, COST_ROAD, ZONE_RESIDENTIAL } from "./constants.ts";
import { processCommands } from "./systems/command-processor.ts";
import {
	captureUndo,
	clearUndo,
	commitUndo,
	createUndoRing,
	restoreUndo,
	type UndoRing,
} from "./undo.ts";

const W = 8;
const H = 8;

function makeCity(): CityState {
	return createCity({ width: W, height: H, seed: 1 });
}

/** One player edit: snapshot, apply, keep the snapshot only if it did anything. */
function edit(
	ring: UndoRing,
	city: CityState,
	x: number,
	y: number,
	kind: "build-road" | "demolish",
): void {
	captureUndo(ring, city);
	if (processCommands(city, [{ kind, x, y }]) > 0) commitUndo(ring);
}

describe("undo ring", () => {
	it("restores the grid and refunds what the edit cost", () => {
		const city = makeCity();
		const ring = createUndoRing(city);
		const idx = 3 * W + 3;
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		edit(ring, city, 3, 3, "build-road");
		expect(city.roads[idx]).toBe(1);
		expect(city.aggregates[AGG.TREASURY]).toBe(before - COST_ROAD);

		expect(restoreUndo(ring, city)).toBe(true);
		expect(city.roads[idx]).toBe(0);
		expect(city.aggregates[AGG.TREASURY]).toBe(before);
	});

	it("unwinds edits one at a time, newest first", () => {
		const city = makeCity();
		const ring = createUndoRing(city);

		edit(ring, city, 1, 1, "build-road");
		edit(ring, city, 2, 1, "build-road");
		edit(ring, city, 3, 1, "build-road");

		expect(restoreUndo(ring, city)).toBe(true);
		expect(city.roads[1 * W + 3]).toBe(0);
		expect(city.roads[1 * W + 2]).toBe(1);

		expect(restoreUndo(ring, city)).toBe(true);
		expect(city.roads[1 * W + 2]).toBe(0);
		expect(city.roads[1 * W + 1]).toBe(1);

		expect(restoreUndo(ring, city)).toBe(true);
		expect(city.roads[1 * W + 1]).toBe(0);
		expect(restoreUndo(ring, city)).toBe(false);
	});

	it("reports an empty ring rather than restoring garbage", () => {
		const city = makeCity();
		const ring = createUndoRing(city);
		expect(restoreUndo(ring, city)).toBe(false);
	});

	it("does not spend a step on an edit that changed nothing", () => {
		const city = makeCity();
		const ring = createUndoRing(city);

		edit(ring, city, 4, 4, "build-road");
		edit(ring, city, 4, 4, "build-road"); // already a road
		expect(ring.count).toBe(1);

		expect(restoreUndo(ring, city)).toBe(true);
		expect(city.roads[4 * W + 4]).toBe(0);
	});

	it("leaves the clock, the demand curves, and the tax rates alone", () => {
		const city = makeCity();
		const ring = createUndoRing(city);

		edit(ring, city, 2, 2, "build-road");
		city.aggregates[AGG.TICK] = 500;
		city.aggregates[AGG.R_DEMAND] = 123;
		city.aggregates[AGG.TAX_RATE_R] = 0.11;

		expect(restoreUndo(ring, city)).toBe(true);
		expect(city.aggregates[AGG.TICK]).toBe(500);
		expect(city.aggregates[AGG.R_DEMAND]).toBe(123);
		expect(city.aggregates[AGG.TAX_RATE_R]).toBe(0.11);
	});

	it("keeps the newest `depth` edits once the ring wraps", () => {
		const city = makeCity();
		const ring = createUndoRing(city);
		const total = ring.depth + 3;

		// One road per column of row 0, more of them than the ring can hold.
		for (let i = 0; i < total; i++) {
			captureUndo(ring, city);
			city.zoning[i] = ZONE_RESIDENTIAL;
			commitUndo(ring);
		}
		expect(ring.count).toBe(ring.depth);

		for (let i = 0; i < ring.depth; i++) {
			expect(restoreUndo(ring, city)).toBe(true);
		}
		expect(restoreUndo(ring, city)).toBe(false);
		// The oldest 3 edits fell off the end and stay applied.
		expect(city.zoning[0]).toBe(ZONE_RESIDENTIAL);
		expect(city.zoning[2]).toBe(ZONE_RESIDENTIAL);
		expect(city.zoning[3]).toBe(0);
	});

	it("drops its history when the city underneath is replaced", () => {
		const city = makeCity();
		const ring = createUndoRing(city);

		edit(ring, city, 5, 5, "build-road");
		clearUndo(ring);

		expect(restoreUndo(ring, city)).toBe(false);
		expect(city.roads[5 * W + 5]).toBe(1);
	});
});
