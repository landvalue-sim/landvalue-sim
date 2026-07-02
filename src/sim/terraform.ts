/**
 * Terraforming — RollerCoaster-Tycoon-style land editing on the vertex
 * corner-height grid.
 *
 * Raising a flat tile lifts all four corners by 1; raising a sloped tile
 * flattens it up to its highest corner (lowering mirrors both). A single
 * corner can be moved instead via CORNER_N/E/S/W. Every edit then propagates
 * outward so adjacent vertices never differ by more than 1 — raising a
 * plateau grows unit slopes around it, exactly like RCT's land tool.
 *
 * Water is per-tile: flooding stores a flat surface height in `waterLevel`;
 * raising submerged terrain above its surface reclaims the tile as land.
 */

import { type CityState, inBounds } from "./city-state.ts";
import {
	BUILDING_EMPTY,
	CIVIC_NONE,
	CORNER_ALL,
	CORNER_E,
	CORNER_N,
	CORNER_S,
	ELEVATION_MAX,
	MAX_GRID_SIZE,
	TERRAIN_LAND,
	TERRAIN_WATER,
} from "./constants.ts";
import { invariant } from "./invariant.ts";

const MAX_VERTEX_SIDE = MAX_GRID_SIZE + 1;
const MAX_VERTEX_COUNT = MAX_VERTEX_SIDE * MAX_VERTEX_SIDE;

/**
 * Pre-allocated propagation scratch (NASA rule 3: no allocation in the tick
 * loop). The BFS wave assigns each vertex its final height for the edit on
 * first touch (seeds share one target and the wave is monotone), so each
 * vertex is enqueued at most once and `MAX_VERTEX_COUNT` bounds everything.
 */
const scratch = {
	queue: new Int32Array(MAX_VERTEX_COUNT),
	// Bounding box of vertices changed by the current edit, for the derived
	// per-tile update.
	minVx: 0,
	minVy: 0,
	maxVx: 0,
	maxVy: 0,
};

/**
 * Apply one raise/lower edit at tile (x, y). `corner` is CORNER_N/E/S/W for a
 * single corner or CORNER_ALL for the whole tile; `dir` is +1 (raise) or -1
 * (lower). Returns true if any height changed (the caller charges only then).
 */
export function terraformTile(
	state: CityState,
	x: number,
	y: number,
	corner: number,
	dir: number,
): boolean {
	if (!inBounds(state.width, state.height, x, y)) return false;
	if (dir !== 1 && dir !== -1) return false;
	if (corner < CORNER_N || corner > CORNER_ALL) return false;
	if (tileOccupied(state, y * state.width + x)) return false;

	const seeded =
		corner === CORNER_ALL
			? seedWholeTile(state, x, y, dir)
			: seedCorner(state, x, y, corner, dir);
	if (seeded === 0) return false;

	propagate(state, seeded, dir);
	updateDerivedTiles(state);
	return true;
}

/**
 * Flood tile (x, y) with a flat water surface at its highest corner, or drain
 * it back to land. Returns true if the tile changed.
 */
export function setWaterTile(
	state: CityState,
	x: number,
	y: number,
	place: boolean,
): boolean {
	if (!inBounds(state.width, state.height, x, y)) return false;
	const idx = y * state.width + x;

	if (!place) {
		if (state.terrain[idx] !== TERRAIN_WATER) return false;
		state.terrain[idx] = TERRAIN_LAND;
		state.waterLevel[idx] = 0;
		return true;
	}

	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (tileOccupied(state, idx)) return false;

	const vw = state.width + 1;
	const heights = state.vertexHeights;
	const level = Math.max(
		heights[y * vw + x] ?? 0,
		heights[y * vw + x + 1] ?? 0,
		heights[(y + 1) * vw + x + 1] ?? 0,
		heights[(y + 1) * vw + x] ?? 0,
	);

	state.terrain[idx] = TERRAIN_WATER;
	state.waterLevel[idx] = level;
	// Flooded land loses its zoning.
	state.zoning[idx] = 0;
	state.densityCap[idx] = 0;
	state.building[idx] = BUILDING_EMPTY;
	state.population[idx] = 0;
	state.jobs[idx] = 0;
	return true;
}

/** Anything built on the tile blocks terraforming and flooding. */
function tileOccupied(state: CityState, idx: number): boolean {
	return (
		state.roads[idx] === 1 ||
		state.rail[idx] === 1 ||
		state.powerLines[idx] === 1 ||
		(state.civic[idx] ?? 0) !== CIVIC_NONE ||
		(state.building[idx] ?? 0) !== BUILDING_EMPTY
	);
}

/**
 * Seed a whole-tile edit: flatten a sloped tile toward `dir`, or shift a flat
 * tile by 1. Writes the target height into each moving corner, queues it, and
 * returns the number of seeded vertices (0 = nothing to do).
 */
function seedWholeTile(
	state: CityState,
	x: number,
	y: number,
	dir: number,
): number {
	const vw = state.width + 1;
	const heights = state.vertexHeights;
	const vN = y * vw + x;
	const vE = y * vw + x + 1;
	const vS = (y + 1) * vw + x + 1;
	const vW = (y + 1) * vw + x;

	const hN = heights[vN] ?? 0;
	const hE = heights[vE] ?? 0;
	const hS = heights[vS] ?? 0;
	const hW = heights[vW] ?? 0;
	const maxC = Math.max(hN, hE, hS, hW);
	const minC = Math.min(hN, hE, hS, hW);

	const target =
		dir > 0 ? (maxC > minC ? maxC : minC + 1) : maxC > minC ? minC : minC - 1;
	if (target < 0 || target > ELEVATION_MAX) return 0;

	resetChangedBounds(x, y);
	let tail = 0;
	const corners = scratch.queue;
	if (dir > 0 ? hN < target : hN > target) corners[tail++] = vN;
	if (dir > 0 ? hE < target : hE > target) corners[tail++] = vE;
	if (dir > 0 ? hS < target : hS > target) corners[tail++] = vS;
	if (dir > 0 ? hW < target : hW > target) corners[tail++] = vW;
	for (let i = 0; i < tail; i++) {
		const v = corners[i] ?? 0;
		heights[v] = target;
		expandChangedBounds(v % vw, Math.floor(v / vw));
	}
	return tail;
}

/** Seed a single-corner edit: move one vertex by `dir`, clamped to range. */
function seedCorner(
	state: CityState,
	x: number,
	y: number,
	corner: number,
	dir: number,
): number {
	const vw = state.width + 1;
	let vx = x;
	let vy = y;
	if (corner === CORNER_E) {
		vx = x + 1;
	} else if (corner === CORNER_S) {
		vx = x + 1;
		vy = y + 1;
	} else if (corner !== CORNER_N) {
		vy = y + 1; // CORNER_W
	}

	const v = vy * vw + vx;
	const target = (state.vertexHeights[v] ?? 0) + dir;
	if (target < 0 || target > ELEVATION_MAX) return 0;

	state.vertexHeights[v] = target;
	scratch.queue[0] = v;
	resetChangedBounds(vx, vy);
	return 1;
}

/**
 * BFS wave from the seeded vertices enforcing |neighbor difference| <= 1.
 * Raising pushes neighbors up to h-1; lowering pulls them down to h+1. The
 * wave is monotone (each ring one step closer to its seeds' shared target),
 * so every vertex settles on first touch and MAX_VERTEX_COUNT bounds the loop.
 */
function propagate(state: CityState, seedCount: number, dir: number): void {
	const vw = state.width + 1;
	const vh = state.height + 1;
	const heights = state.vertexHeights;
	const queue = scratch.queue;
	let head = 0;
	let tail = seedCount;

	for (let iter = 0; iter < MAX_VERTEX_COUNT; iter++) {
		if (head >= tail) break;
		const v = queue[head] ?? 0;
		head++;
		const limit = (heights[v] ?? 0) - dir; // h-1 when raising, h+1 lowering
		const vx = v % vw;
		const vy = Math.floor(v / vw);

		if (vx > 0) tail = relax(heights, v - 1, limit, dir, queue, tail, vw);
		if (vx < vw - 1) tail = relax(heights, v + 1, limit, dir, queue, tail, vw);
		if (vy > 0) tail = relax(heights, v - vw, limit, dir, queue, tail, vw);
		if (vy < vh - 1) tail = relax(heights, v + vw, limit, dir, queue, tail, vw);
	}
	invariant(head >= tail, "terraform propagation did not drain its queue");
}

/** Pull one neighbor within range of `limit`; queue it if it moved. */
function relax(
	heights: Uint8Array,
	v: number,
	limit: number,
	dir: number,
	queue: Int32Array,
	tail: number,
	vw: number,
): number {
	const h = heights[v] ?? 0;
	if (dir > 0 ? h >= limit : h <= limit) return tail;
	invariant(tail < MAX_VERTEX_COUNT, "terraform queue overflow");
	heights[v] = limit;
	queue[tail] = v;
	expandChangedBounds(v % vw, Math.floor(v / vw));
	return tail + 1;
}

function resetChangedBounds(vx: number, vy: number): void {
	scratch.minVx = vx;
	scratch.maxVx = vx;
	scratch.minVy = vy;
	scratch.maxVy = vy;
}

function expandChangedBounds(vx: number, vy: number): void {
	if (vx < scratch.minVx) scratch.minVx = vx;
	if (vx > scratch.maxVx) scratch.maxVx = vx;
	if (vy < scratch.minVy) scratch.minVy = vy;
	if (vy > scratch.maxVy) scratch.maxVy = vy;
}

/**
 * Refresh the derived per-tile layers for every tile touching a changed
 * vertex: `elevation` = min corner, and water tiles whose terrain now pokes
 * above their surface are reclaimed as land.
 */
function updateDerivedTiles(state: CityState): void {
	const { width, height, terrain, elevation, vertexHeights, waterLevel } =
		state;
	const vw = width + 1;
	const x0 = Math.max(0, scratch.minVx - 1);
	const x1 = Math.min(width - 1, scratch.maxVx);
	const y0 = Math.max(0, scratch.minVy - 1);
	const y1 = Math.min(height - 1, scratch.maxVy);

	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const hn = vertexHeights[y * vw + x] ?? 0;
			const he = vertexHeights[y * vw + x + 1] ?? 0;
			const hs = vertexHeights[(y + 1) * vw + x + 1] ?? 0;
			const hw = vertexHeights[(y + 1) * vw + x] ?? 0;

			const idx = y * width + x;
			elevation[idx] = Math.min(hn, he, hs, hw);
			if (
				terrain[idx] === TERRAIN_WATER &&
				Math.max(hn, he, hs, hw) > (waterLevel[idx] ?? 0)
			) {
				terrain[idx] = TERRAIN_LAND;
				waterLevel[idx] = 0;
			}
		}
	}
}
