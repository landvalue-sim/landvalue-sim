import { describe, expect, it } from "vitest";
import { fitZoom, HALF_H, HALF_W } from "./iso.ts";

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
