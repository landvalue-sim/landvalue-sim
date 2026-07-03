/**
 * Elevation-aware tile picking — pure functions, no Phaser dependency.
 *
 * A cursor's screen point can belong to several stacked surfaces; picking
 * marches a probe down the elevation planes (top-down) and takes the first
 * plane at or below the terrain surface, which brackets the visible
 * cursor/surface crossing. The crossing is then refined by bisection so
 * sloped tiles resolve to their true surface point, not the flat plane at
 * their highest corner. Comparing against the *interpolated* surface height
 * (rather than requiring a plane to exactly equal a tile's max corner) is
 * what makes hovering the downhill half of a slope select that slope tile
 * instead of falling through to the tile whose base plane sits under the
 * cursor.
 */

import type { CityState } from "../sim/index.ts";
import { ELEVATION_MAX, TERRAIN_WATER } from "../sim/index.ts";
import { ELEV_HEIGHT, screenToGrid } from "./iso.ts";

// Bisection steps when refining the surface crossing. 8 steps resolve the
// probe height to 1/256 of a level (< 0.02 world-px) — beyond hover accuracy.
const PICK_REFINE_ITERATIONS = 8;

export interface PickResult {
	x: number;
	y: number;
	/**
	 * Fractional position within the picked tile (0..1 each axis), for
	 * corner-precision terraforming. Meaningful only when (x, y) is in bounds.
	 */
	fx: number;
	fy: number;
}

/**
 * Pick the tile whose visible surface (sloped land or flat water plane) is
 * front-most under the world-space point (sx, sy). Falls back to the
 * ground-plane tile when no surface is hit (e.g. beyond the map edge); the
 * result may then be out of bounds — callers check.
 */
export function pickTile(city: CityState, sx: number, sy: number): PickResult {
	// Highest probe known to be above the surface, bracketing the crossing.
	let above = ELEVATION_MAX + 1;
	for (let e = ELEVATION_MAX; e >= 0; e--) {
		if (sampleSurface(city, sx, sy, e) >= e) {
			let hit = e;
			for (let i = 0; i < PICK_REFINE_ITERATIONS; i++) {
				const mid = (hit + above) / 2;
				if (sampleSurface(city, sx, sy, mid) >= mid) {
					hit = mid;
				} else {
					above = mid;
				}
			}
			return resultAt(sx, sy, hit);
		}
		above = e;
	}
	return resultAt(sx, sy, 0);
}

/** Height (0..ELEVATION_MAX) of a tile's surface: water plane or max corner. */
export function tileSurfaceHeight(
	city: CityState,
	x: number,
	y: number,
): number {
	const idx = y * city.width + x;
	if (city.terrain[idx] === TERRAIN_WATER) return city.waterLevel[idx] ?? 0;
	const vw = city.width + 1;
	const heights = city.vertexHeights;
	return Math.max(
		heights[y * vw + x] ?? 0,
		heights[y * vw + x + 1] ?? 0,
		heights[(y + 1) * vw + x + 1] ?? 0,
		heights[(y + 1) * vw + x] ?? 0,
	);
}

/**
 * Surface height under the probe at elevation plane `e`: project the point
 * onto the plane, find the tile there, and bilinearly interpolate its corner
 * heights (water tiles are flat at their water level). Returns -1 when the
 * projected point leaves the map, which every probe reads as "above the
 * surface".
 */
function sampleSurface(
	city: CityState,
	sx: number,
	sy: number,
	e: number,
): number {
	const gpt = screenToGrid(sx, sy + e * ELEV_HEIGHT);
	const tx = Math.floor(gpt.x);
	const ty = Math.floor(gpt.y);
	if (tx < 0 || ty < 0 || tx >= city.width || ty >= city.height) return -1;

	const idx = ty * city.width + tx;
	if (city.terrain[idx] === TERRAIN_WATER) return city.waterLevel[idx] ?? 0;

	const vw = city.width + 1;
	const heights = city.vertexHeights;
	const hn = heights[ty * vw + tx] ?? 0;
	const he = heights[ty * vw + tx + 1] ?? 0;
	const hs = heights[(ty + 1) * vw + tx + 1] ?? 0;
	const hw = heights[(ty + 1) * vw + tx] ?? 0;
	const fx = gpt.x - tx;
	const fy = gpt.y - ty;
	const top = hn + (he - hn) * fx;
	const bot = hw + (hs - hw) * fx;
	return top + (bot - top) * fy;
}

/** Tile and in-tile fraction of the projection at elevation plane `e`. */
function resultAt(sx: number, sy: number, e: number): PickResult {
	const gpt = screenToGrid(sx, sy + e * ELEV_HEIGHT);
	const tx = Math.floor(gpt.x);
	const ty = Math.floor(gpt.y);
	return { x: tx, y: ty, fx: gpt.x - tx, fy: gpt.y - ty };
}
