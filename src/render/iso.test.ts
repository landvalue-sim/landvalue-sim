import { describe, expect, it } from "vitest";
import {
	fitZoom,
	gridToScreen,
	HALF_H,
	HALF_W,
	mapWorldBounds,
} from "./iso.ts";

/** Screen-px the grid occupies at `zoom`, ignoring elevation headroom. */
function screenSpan(
	w: number,
	h: number,
	zoom: number,
): { sw: number; sh: number } {
	const span = w + h;
	return { sw: span * HALF_W * zoom, sh: span * HALF_H * zoom };
}

describe("fitZoom", () => {
	it("fits a 256x256 grid on a 1600x900 canvas at the width-limited zoom", () => {
		// Diamond is 512 tiles across: 8192 world-px wide, 4096 tall. With 16px
		// margins the width axis binds first: 1568 / 8192.
		expect(fitZoom(256, 256, 1600, 900)).toBeCloseTo(0.19140625, 10);
	});

	it("keeps the whole grid inside the canvas", () => {
		const cases = [
			{ w: 64, h: 64, cw: 1600, ch: 900 },
			{ w: 256, h: 256, cw: 1600, ch: 900 },
			{ w: 256, h: 256, cw: 800, ch: 1200 },
			{ w: 512, h: 128, cw: 1280, ch: 720 },
		] as const;
		for (const c of cases) {
			const { sw, sh } = screenSpan(c.w, c.h, fitZoom(c.w, c.h, c.cw, c.ch));
			expect(sw).toBeLessThanOrEqual(c.cw);
			expect(sh).toBeLessThanOrEqual(c.ch);
		}
	});

	it("halves the zoom when the grid span doubles", () => {
		// Width-limited on both, so the ratio is exact.
		const small = fitZoom(64, 64, 1600, 4000);
		const big = fitZoom(128, 128, 1600, 4000);
		expect(big).toBeCloseTo(small / 2, 10);
	});

	it("shrinks with the canvas and grows with it", () => {
		expect(fitZoom(256, 256, 800, 600)).toBeLessThan(
			fitZoom(256, 256, 1600, 1200),
		);
	});

	it("stays positive on a canvas smaller than the margins", () => {
		expect(fitZoom(256, 256, 8, 8)).toBeGreaterThan(0);
	});
});

describe("mapWorldBounds", () => {
	it("encloses every tile corner of a 256x128 grid", () => {
		const w = 256;
		const h = 128;
		const b = mapWorldBounds(w, h, 0);
		// Extreme projected corners: west corner of tile (0, h-1), east corner
		// of (w-1, 0), north corner of (0, 0), south corner of (w-1, h-1).
		const west = gridToScreen(0, h - 1).x - HALF_W;
		const east = gridToScreen(w - 1, 0).x + HALF_W;
		const north = gridToScreen(0, 0).y;
		const south = gridToScreen(w - 1, h - 1).y + 2 * HALF_H;
		expect(b.x0).toBe(west);
		expect(b.x0 + b.width).toBe(east);
		expect(b.y0).toBe(north);
		expect(b.y0 + b.height).toBe(south);
	});

	it("extends only the top edge by the headroom", () => {
		const flat = mapWorldBounds(64, 64, 0);
		const padded = mapWorldBounds(64, 64, 200);
		expect(padded.y0).toBe(flat.y0 - 200);
		expect(padded.y0 + padded.height).toBe(flat.y0 + flat.height);
		expect(padded.x0).toBe(flat.x0);
		expect(padded.width).toBe(flat.width);
	});

	it("matches the span fitZoom fits to", () => {
		// fitZoom and mapWorldBounds must agree on the projected diamond size,
		// or the full-map bake condition would disagree with the zoom-out limit.
		const b = mapWorldBounds(256, 256, 0);
		expect(b.width).toBe((256 + 256) * HALF_W);
		expect(b.height).toBe((256 + 256) * HALF_H);
	});
});
