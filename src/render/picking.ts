/**
 * Rendered-surface-aware tile picking — pure functions, no Phaser dependency.
 *
 * A cursor's screen point can belong to several stacked surfaces; picking
 * marches a probe down the lift axis (top-down) and takes the first point
 * where the rendered face under the probe's projection rises to meet it,
 * which brackets the visible cursor/surface crossing. The crossing is then
 * refined by bisection so sloped tiles resolve to their true surface point,
 * not the flat plane at their highest corner.
 *
 * Face heights come from the bake's per-tile record (see rendered-surface.ts),
 * so picking agrees with the pixels on screen in every overlay mode: a value
 * column is picked at its drawn top, a graded road at its graded surface, and
 * a face in front occludes one behind exactly as rendered. Tiles the record
 * does not cover — unbaked ground, or any pick before the first bake — fall
 * back to raw terrain geometry (flat water plane or bilinearly interpolated
 * corner heights), which is what the bake would have drawn for them.
 */

import type { CityState } from "../sim/index.ts";
import { ELEVATION_MAX, TERRAIN_WATER } from "../sim/index.ts";
import { invariant } from "../sim/invariant.ts";
import { ELEV_HEIGHT, screenToGrid } from "./iso.ts";
import { type RenderedSurface, readTileFace } from "./rendered-surface.ts";

// Bisection steps when refining the surface crossing. 8 steps resolve the
// probe height to 1/256 of the bracket (< 0.5 world-px) — beyond hover
// accuracy.
const PICK_REFINE_ITERATIONS = 8;

// Coarse march step. Rendered faces are discontinuous at tile edges (value
// columns), so the march can skip a face sliver thinner than one step where
// it meets the probe near a tile boundary; 2 px keeps that blind zone under
// cursor size. Terrain and water are continuous and cannot be skipped.
const PICK_LIFT_STEP_PX = 2;

// Hard bound on the march (fixed loop bound): covers max terrain lift plus
// the tallest overlay column with generous headroom.
const PICK_MAX_PROBE_STEPS = 128;

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
 * Pick the tile whose rendered surface is front-most under the world-space
 * point (sx, sy). Falls back to the ground-plane tile when no surface is hit
 * (e.g. beyond the map edge); the result may then be out of bounds — callers
 * check.
 */
export function pickTile(
	city: CityState,
	render: RenderedSurface,
	sx: number,
	sy: number,
): PickResult {
	// March from just above the tallest thing on screen: the tallest recorded
	// face this bake, or the terrain ceiling for tiles the record doesn't
	// cover. Elevation planes alone would stop short of tall value columns.
	const terrainMax = ELEVATION_MAX * ELEV_HEIGHT;
	const maxLift = render.maxLift > terrainMax ? render.maxLift : terrainMax;
	const steps = Math.min(
		Math.ceil(maxLift / PICK_LIFT_STEP_PX) + 1,
		PICK_MAX_PROBE_STEPS,
	);
	invariant(
		maxLift <= (PICK_MAX_PROBE_STEPS - 1) * PICK_LIFT_STEP_PX,
		"picking: rendered lift exceeds the probe march bound",
	);

	// Lowest probe known to be above the surface, bracketing the crossing.
	let above = (steps + 1) * PICK_LIFT_STEP_PX;
	for (let i = steps; i >= 0; i--) {
		const probe = i * PICK_LIFT_STEP_PX;
		if (sampleRenderedLift(city, render, sx, sy, probe) >= probe) {
			let hit = probe;
			for (let r = 0; r < PICK_REFINE_ITERATIONS; r++) {
				const mid = (hit + above) / 2;
				if (sampleRenderedLift(city, render, sx, sy, mid) >= mid) {
					hit = mid;
				} else {
					above = mid;
				}
			}
			return resultAtLift(sx, sy, hit);
		}
		above = probe;
	}
	return resultAtLift(sx, sy, 0);
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

// Pre-allocated output buffer for readTileFace (avoids per-sample allocation).
const _pickFace = new Float32Array(4);

/**
 * Rendered-face lift (world px) under the probe: project the point onto the
 * plane at `liftPx`, find the tile there, and bilinearly interpolate its
 * recorded corner lifts. Unrecorded tiles interpolate raw terrain instead
 * (water tiles are flat at their water level). Returns -1 when the projected
 * point leaves the map, which every probe reads as "above the surface".
 */
function sampleRenderedLift(
	city: CityState,
	render: RenderedSurface,
	sx: number,
	sy: number,
	liftPx: number,
): number {
	const gpt = screenToGrid(sx, sy + liftPx);
	const tx = Math.floor(gpt.x);
	const ty = Math.floor(gpt.y);
	if (tx < 0 || ty < 0 || tx >= city.width || ty >= city.height) return -1;
	const fx = gpt.x - tx;
	const fy = gpt.y - ty;

	const idx = ty * city.width + tx;
	if (readTileFace(render, idx, _pickFace)) {
		const ln = _pickFace[0] ?? 0;
		const le = _pickFace[1] ?? 0;
		const ls = _pickFace[2] ?? 0;
		const lw = _pickFace[3] ?? 0;
		const top = ln + (le - ln) * fx;
		const bot = lw + (ls - lw) * fx;
		return top + (bot - top) * fy;
	}

	if (city.terrain[idx] === TERRAIN_WATER) {
		return (city.waterLevel[idx] ?? 0) * ELEV_HEIGHT;
	}
	const vw = city.width + 1;
	const heights = city.vertexHeights;
	const hn = heights[ty * vw + tx] ?? 0;
	const he = heights[ty * vw + tx + 1] ?? 0;
	const hs = heights[(ty + 1) * vw + tx + 1] ?? 0;
	const hw = heights[(ty + 1) * vw + tx] ?? 0;
	const top = hn + (he - hn) * fx;
	const bot = hw + (hs - hw) * fx;
	return (top + (bot - top) * fy) * ELEV_HEIGHT;
}

/** Tile and in-tile fraction of the projection at lift `liftPx`. */
function resultAtLift(sx: number, sy: number, liftPx: number): PickResult {
	const gpt = screenToGrid(sx, sy + liftPx);
	const tx = Math.floor(gpt.x);
	const ty = Math.floor(gpt.y);
	return { x: tx, y: ty, fx: gpt.x - tx, fy: gpt.y - ty };
}
