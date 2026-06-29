/**
 * Drag-to-draw geometry — pure tile-set helpers for click-and-drag placement.
 *
 * Roads form an L-shaped path (along the row from the start, then down the
 * column to the end); zones and demolish fill the rectangle spanned by the two
 * corners. Pure and deterministic so the logic is unit-testable without Phaser.
 */

export interface Point {
	readonly x: number;
	readonly y: number;
}

// The grid is bounded to MAX_GRID_SIZE; cap the segment loops defensively so a
// bad input can never spin forever (NASA rule 2: provable loop bounds).
const MAX_SPAN = 256;

/** Append the inclusive horizontal run from x0 to x1 along row y. */
function pushRow(tiles: Point[], x0: number, x1: number, y: number): void {
	const s = x1 >= x0 ? 1 : -1;
	for (let x = x0, i = 0; i <= MAX_SPAN; x += s, i++) {
		tiles.push({ x, y });
		if (x === x1) break;
	}
}

/** Append the inclusive vertical run from y0 to y1 along column x. */
function pushCol(tiles: Point[], x: number, y0: number, y1: number): void {
	const s = y1 >= y0 ? 1 : -1;
	for (let y = y0, i = 0; i <= MAX_SPAN; y += s, i++) {
		tiles.push({ x, y });
		if (y === y1) break;
	}
}

/**
 * L-shaped road path from (ax,ay) to (bx,by). `horizontalFirst` controls the
 * elbow: true runs the row first then the column (elbow at (bx,ay)); false runs
 * the column first then the row (elbow at (ax,by)). The corner tile is placed
 * once.
 */
export function roadLineTiles(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	horizontalFirst = true,
): Point[] {
	const tiles: Point[] = [];

	if (horizontalFirst) {
		pushRow(tiles, ax, bx, ay);
		if (by !== ay) {
			pushCol(tiles, bx, ay + (by >= ay ? 1 : -1), by);
		}
	} else {
		pushCol(tiles, ax, ay, by);
		if (bx !== ax) {
			pushRow(tiles, ax + (bx >= ax ? 1 : -1), bx, by);
		}
	}

	return tiles;
}

/** Every tile in the rectangle spanned by the two corners (inclusive). */
export function rectTiles(
	ax: number,
	ay: number,
	bx: number,
	by: number,
): Point[] {
	const x0 = Math.min(ax, bx);
	const x1 = Math.max(ax, bx);
	const y0 = Math.min(ay, by);
	const y1 = Math.max(ay, by);

	const tiles: Point[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			tiles.push({ x, y });
		}
	}
	return tiles;
}
