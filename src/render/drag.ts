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

/** L-shaped road path from (ax,ay) to (bx,by): the row first, then the column. */
export function roadLineTiles(
	ax: number,
	ay: number,
	bx: number,
	by: number,
): Point[] {
	const tiles: Point[] = [];

	const sx = bx >= ax ? 1 : -1;
	for (let x = ax, i = 0; i <= MAX_SPAN; x += sx, i++) {
		tiles.push({ x, y: ay });
		if (x === bx) break;
	}

	if (by !== ay) {
		const sy = by >= ay ? 1 : -1;
		// Start past the corner (bx,ay), which the row loop already placed.
		for (let y = ay + sy, i = 0; i <= MAX_SPAN; y += sy, i++) {
			tiles.push({ x: bx, y });
			if (y === by) break;
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
