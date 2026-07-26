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

/** Vertical world-pixels of terrain lift per corner-height unit. */
export const ELEV_HEIGHT = 3;

export interface Point {
	x: number;
	y: number;
}

// ---- Fit-to-map ------------------------------------------------------------
// World-px of headroom kept above the grid's top corner when fitting the whole
// map on screen: max terrain lift (ELEVATION_MAX units) plus a tall building.
const FIT_HEADROOM_PX = 96;
/** Screen-px of breathing room kept on every side of a fitted map. */
const FIT_MARGIN_PX = 16;

/**
 * Camera zoom at which a `w` x `h` grid fits inside a `canvasW` x `canvasH`
 * canvas. The grid projects to a diamond `(w + h)` tiles across both diagonals,
 * so both world dimensions scale with that span — a 256x256 map needs roughly a
 * quarter of the zoom a 64x64 one does.
 *
 * Result is unclamped: callers decide the usable zoom range (see `minZoom` in
 * iso-scene). Returns Infinity for a degenerate empty grid.
 */
export function fitZoom(
	w: number,
	h: number,
	canvasW: number,
	canvasH: number,
): number {
	const span = w + h;
	const worldW = span * HALF_W;
	const worldH = span * HALF_H + FIT_HEADROOM_PX;
	// A canvas smaller than the margins still yields a positive zoom rather than
	// a negative one that would flip the view.
	const usableW = Math.max(1, canvasW - 2 * FIT_MARGIN_PX);
	const usableH = Math.max(1, canvasH - 2 * FIT_MARGIN_PX);
	return Math.min(usableW / worldW, usableH / worldH);
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
