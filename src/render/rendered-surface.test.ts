import { describe, expect, it } from "vitest";
import {
	beginSurfaceBake,
	createRenderedSurface,
	readTileFace,
	recordTileFace,
} from "./rendered-surface.ts";

describe("rendered-surface", () => {
	it("reads nothing before the first bake", () => {
		const s = createRenderedSurface(4, 4);
		const out = new Float32Array(4);
		for (let i = 0; i < 16; i++) {
			expect(readTileFace(s, i, out)).toBe(false);
		}
	});

	it("round-trips recorded corner lifts exactly", () => {
		const s = createRenderedSurface(4, 4);
		beginSurfaceBake(s);
		recordTileFace(s, 5, 1.5, 2.5, 3.5, 4.5);
		const out = new Float32Array(4);
		expect(readTileFace(s, 5, out)).toBe(true);
		expect(Array.from(out)).toEqual([1.5, 2.5, 3.5, 4.5]);
	});

	it("leaves unrecorded tiles unreadable within a bake", () => {
		const s = createRenderedSurface(4, 4);
		beginSurfaceBake(s);
		recordTileFace(s, 0, 1, 1, 1, 1);
		const out = new Float32Array(4);
		expect(readTileFace(s, 1, out)).toBe(false);
	});

	it("invalidates every tile when a new bake begins", () => {
		const s = createRenderedSurface(4, 4);
		beginSurfaceBake(s);
		recordTileFace(s, 7, 10, 10, 10, 10);
		beginSurfaceBake(s);
		const out = new Float32Array(4);
		expect(readTileFace(s, 7, out)).toBe(false);
		// Re-recording under the new generation makes it readable again.
		recordTileFace(s, 7, 20, 20, 20, 20);
		expect(readTileFace(s, 7, out)).toBe(true);
		expect(Array.from(out)).toEqual([20, 20, 20, 20]);
	});

	it("does not touch the out buffer on a miss", () => {
		const s = createRenderedSurface(2, 2);
		beginSurfaceBake(s);
		const out = new Float32Array([9, 9, 9, 9]);
		expect(readTileFace(s, 3, out)).toBe(false);
		expect(Array.from(out)).toEqual([9, 9, 9, 9]);
	});

	it("tracks the tallest recorded lift, resetting each bake", () => {
		const s = createRenderedSurface(2, 2);
		expect(s.maxLift).toBe(0);
		beginSurfaceBake(s);
		recordTileFace(s, 0, 3, 10, 4, 5);
		expect(s.maxLift).toBe(10);
		recordTileFace(s, 1, 2, 2, 2, 2);
		expect(s.maxLift).toBe(10);
		beginSurfaceBake(s);
		expect(s.maxLift).toBe(0);
	});

	it("survives generation wrap-around without stale reads", () => {
		const s = createRenderedSurface(2, 2);
		beginSurfaceBake(s);
		recordTileFace(s, 0, 5, 5, 5, 5);
		// Force the counter to its ceiling; the next bake resets stamps and
		// restarts at generation 1 — the old record must not alias as fresh.
		s.generation = 0xffffffff;
		s.stamps[0] = 0xffffffff;
		beginSurfaceBake(s);
		expect(s.generation).toBe(1);
		const out = new Float32Array(4);
		expect(readTileFace(s, 0, out)).toBe(false);
	});
});
