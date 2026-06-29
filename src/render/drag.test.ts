import { describe, expect, it } from "vitest";
import { rectTiles, roadLineTiles } from "./drag.ts";

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
