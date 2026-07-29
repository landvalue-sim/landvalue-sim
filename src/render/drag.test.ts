import { describe, expect, it } from "vitest";
import { clampRectSpan, rectTiles, roadLineTiles } from "./drag.ts";

describe("roadLineTiles", () => {
	it("returns a single tile when start === end", () => {
		expect(roadLineTiles(3, 3, 3, 3)).toEqual([{ x: 3, y: 3 }]);
	});

	it("draws a straight horizontal run", () => {
		expect(roadLineTiles(1, 2, 4, 2)).toEqual([
			{ x: 1, y: 2 },
			{ x: 2, y: 2 },
			{ x: 3, y: 2 },
			{ x: 4, y: 2 },
		]);
	});

	it("draws a straight vertical run", () => {
		expect(roadLineTiles(5, 1, 5, 3)).toEqual([
			{ x: 5, y: 1 },
			{ x: 5, y: 2 },
			{ x: 5, y: 3 },
		]);
	});

	it("draws an L-shape (row then column) without repeating the corner", () => {
		const tiles = roadLineTiles(0, 0, 2, 2);
		expect(tiles).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 2, y: 2 },
		]);
		const corner = tiles.filter((t) => t.x === 2 && t.y === 0);
		expect(corner).toHaveLength(1);
	});

	it("handles a negative-direction L-shape", () => {
		expect(roadLineTiles(2, 2, 0, 0)).toEqual([
			{ x: 2, y: 2 },
			{ x: 1, y: 2 },
			{ x: 0, y: 2 },
			{ x: 0, y: 1 },
			{ x: 0, y: 0 },
		]);
	});

	it("draws a vertical-first L-shape when horizontalFirst is false", () => {
		expect(roadLineTiles(0, 0, 2, 2, false)).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 1 },
			{ x: 0, y: 2 },
			{ x: 1, y: 2 },
			{ x: 2, y: 2 },
		]);
	});

	it("draws a vertical-first L-shape in the negative direction", () => {
		expect(roadLineTiles(2, 2, 0, 0, false)).toEqual([
			{ x: 2, y: 2 },
			{ x: 2, y: 1 },
			{ x: 2, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 0 },
		]);
	});

	it("orientation is irrelevant for a straight run", () => {
		expect(roadLineTiles(1, 2, 4, 2, false)).toEqual(
			roadLineTiles(1, 2, 4, 2, true),
		);
	});
});

describe("rectTiles", () => {
	it("returns a single tile when start === end", () => {
		expect(rectTiles(2, 2, 2, 2)).toEqual([{ x: 2, y: 2 }]);
	});

	it("fills a rectangle inclusive of both corners", () => {
		expect(rectTiles(1, 1, 2, 2)).toEqual([
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
			{ x: 1, y: 2 },
			{ x: 2, y: 2 },
		]);
	});

	it("normalizes corner order", () => {
		expect(rectTiles(2, 2, 1, 1)).toEqual(rectTiles(1, 1, 2, 2));
	});

	it("counts every tile in the span", () => {
		expect(rectTiles(0, 0, 4, 2)).toHaveLength(5 * 3);
	});
});

describe("clampRectSpan", () => {
	it("leaves a rectangle inside the limit alone", () => {
		expect(clampRectSpan(10, 10, 13, 12, 8)).toEqual({ x: 13, y: 12 });
	});

	it("allows exactly maxSide tiles on an axis", () => {
		// Inclusive span: a reach of maxSide-1 from the anchor is maxSide tiles.
		expect(clampRectSpan(0, 0, 7, 7, 8)).toEqual({ x: 7, y: 7 });
		expect(rectTiles(0, 0, 7, 7)).toHaveLength(8 * 8);
	});

	it("pulls the far corner back toward the anchor on both axes", () => {
		expect(clampRectSpan(0, 0, 100, 100, 8)).toEqual({ x: 7, y: 7 });
	});

	it("anchors on the drag start when the drag runs up or left", () => {
		// The start stays put and the rectangle stops growing under the pointer,
		// rather than sliding along after it.
		expect(clampRectSpan(50, 50, 0, 0, 8)).toEqual({ x: 43, y: 43 });
	});

	it("clamps each axis independently", () => {
		expect(clampRectSpan(20, 20, 100, 22, 8)).toEqual({ x: 27, y: 22 });
		expect(clampRectSpan(20, 20, 22, 100, 8)).toEqual({ x: 22, y: 27 });
	});

	it("collapses to the anchor at a limit of one", () => {
		expect(clampRectSpan(4, 9, 40, 90, 1)).toEqual({ x: 4, y: 9 });
	});
});
