/**
 * Isometric grid <-> screen transforms.
 *
 * Tiles are diamonds `2*HALF_W` wide and `2*HALF_H` tall. A tile (x, y) maps to
 * world space with the standard iso projection; depth is `x + y` so a
 * back-to-front diagonal sweep draws raised buildings with correct occlusion.
 * Phaser's accelerated tilemap is orthographic-only, so this is custom (see
 * DesignDocs/DESIGN.md).
 */

export const HALF_W = 16;
export const HALF_H = 8;

/** Vertical world-pixels a building rises per density tier. */
export const TIER_HEIGHT = 11;

export interface Point {
	x: number;
	y: number;
}

/** Grid (x, y) -> world-space pixel at the tile's center. */
export function gridToScreen(x: number, y: number): Point {
	return { x: (x - y) * HALF_W, y: (x + y) * HALF_H };
}

/** World-space pixel -> fractional grid coordinate (caller floors/bounds). */
export function screenToGrid(sx: number, sy: number): Point {
	const a = sx / HALF_W;
	const b = sy / HALF_H;
	return { x: (a + b) / 2, y: (b - a) / 2 };
}
