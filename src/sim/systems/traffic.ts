/**
 * Traffic system — compute per-road-tile congestion from commute volume.
 *
 * Residential tiles generate trips to occupied C/I tiles within Manhattan
 * radius TRAFFIC_SPREAD_RADIUS. Each trip walks horizontally then vertically;
 * every ROAD tile at path-step k (1-based) gains
 * max(1, floor(load * TRAFFIC_DECAY^(k-1))), saturating at MAX_TRAFFIC.
 *
 * Rather than walking every (R, C/I) pair — O(R tiles x diamond area x path
 * length), which blew the tick budget on 256x256 maps (issue #11) — this
 * implementation counts trips per tile. Saturating addition of positive
 * contributions is order-independent, so the result is byte-identical:
 *
 * - Horizontal legs all run along the resident's own row, so the road tile at
 *   distance h is crossed by exactly the targets whose column offset is >= h
 *   on that side. A reverse sweep over per-column diamond-segment counts
 *   (O(1) each via column prefix sums) yields those suffix counts.
 * - A vertical leg runs in its target's column, so the road tile v rows from
 *   home in column offset e is crossed by exactly the targets in that column
 *   at vertical distance >= v, at step value |e| + v. A reverse sweep down
 *   each column accumulates those counts directly.
 *
 * Rail tiles absorb some capacity, reducing every load. High traffic lowers
 * adjacent land value and adds pollution (handled in their own systems).
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	MAX_GRID_SIZE,
	MAX_TRAFFIC,
	TRAFFIC_DECAY,
	TRAFFIC_SPREAD_RADIUS,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

const RADIUS = TRAFFIC_SPREAD_RADIUS;

// Per-trip contribution at path-step k is max(1, floor(load * DECAY^(k-1))),
// precomputed for every load a Uint8 building tier can produce. k never
// exceeds RADIUS because a trip's total length |dx|+|dy| is capped there.
const STEP_VALUES = new Uint8Array(256 * RADIUS);
for (let load = 1; load < 256; load++) {
	for (let k = 1; k <= RADIUS; k++) {
		STEP_VALUES[load * RADIUS + (k - 1)] = Math.max(
			1,
			Math.floor(load * TRAFFIC_DECAY ** (k - 1)),
		);
	}
}

// Pre-allocated scratch: occupied C/I indicator per tile, and per-column
// prefix sums of it so any vertical segment count reads in O(1).
// colPrefix is column-major with stride (height + 1); entry y+1 holds the
// count of job tiles in rows [0, y] of that column.
const jobFlags = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const colPrefix = new Uint16Array(MAX_GRID_SIZE * (MAX_GRID_SIZE + 1));

export function updateTraffic(state: CityState): void {
	const { width, size, zoning, building, roads, rail, traffic } = state;

	// Reset traffic
	traffic.fill(0);

	// Count rail tiles for capacity offset
	let railCount = 0;
	for (let i = 0; i < size; i++) {
		if (rail[i] === 1) railCount++;
	}
	// Rail absorbs some commuter load: each rail tile reduces effective traffic
	const railReduction = Math.min(0.5, railCount * 0.005);

	buildJobIndex(state);

	// For each occupied R tile, add both legs of every trip it generates
	for (let i = 0; i < size; i++) {
		if (zoning[i] !== ZONE_RESIDENTIAL || building[i] === BUILDING_EMPTY)
			continue;

		const rx = i % width;
		const ry = (i - rx) / width;
		const density = building[i] ?? 1;
		const load = Math.max(1, Math.floor(density * (1 - railReduction)));

		spreadHorizontal(state, rx, ry, load);
		spreadVertical(state, rx, ry, load);
	}

	// Compute average congestion for AGG
	let totalTraffic = 0;
	let roadCount = 0;
	for (let i = 0; i < size; i++) {
		if (roads[i] === 1) {
			totalTraffic += traffic[i] ?? 0;
			roadCount++;
		}
	}
	state.aggregates[AGG.TRAFFIC_CONGESTION] =
		roadCount > 0 ? totalTraffic / roadCount : 0;
}

/** Rebuild the occupied-C/I indicator and its per-column prefix sums. */
function buildJobIndex(state: CityState): void {
	const { width, height, zoning, building } = state;
	const stride = height + 1;

	for (let x = 0; x < width; x++) {
		const colBase = x * stride;
		colPrefix[colBase] = 0;
		for (let y = 0; y < height; y++) {
			const i = y * width + x;
			const z = zoning[i];
			const isJob =
				(z === ZONE_COMMERCIAL || z === ZONE_INDUSTRIAL) &&
				building[i] !== BUILDING_EMPTY
					? 1
					: 0;
			jobFlags[i] = isJob;
			colPrefix[colBase + y + 1] = (colPrefix[colBase + y] ?? 0) + isJob;
		}
	}
}

/**
 * Horizontal legs from (rx, ry): the road tile at distance e on the home row
 * is crossed by every trip whose target sits at column offset >= e on that
 * side of the diamond, so sweep e downward accumulating a suffix count.
 */
function spreadHorizontal(
	state: CityState,
	rx: number,
	ry: number,
	load: number,
): void {
	const { width, height, roads, traffic } = state;
	const stride = height + 1;
	const valBase = load * RADIUS;

	for (let dir = -1; dir <= 1; dir += 2) {
		let trips = 0;
		for (let e = RADIUS; e >= 1; e--) {
			const cx = rx + dir * e;
			if (cx < 0 || cx >= width) continue;

			// Targets in this column within the diamond: |dy| <= RADIUS - e.
			const half = RADIUS - e;
			const y0 = ry - half < 0 ? 0 : ry - half;
			const y1 = ry + half >= height ? height - 1 : ry + half;
			const colBase = cx * stride;
			trips +=
				(colPrefix[colBase + y1 + 1] ?? 0) - (colPrefix[colBase + y0] ?? 0);
			if (trips === 0) continue;

			const ti = ry * width + cx;
			if (roads[ti] === 1) {
				const add = (STEP_VALUES[valBase + e - 1] ?? 1) * trips;
				const next = (traffic[ti] ?? 0) + add;
				traffic[ti] = next > MAX_TRAFFIC ? MAX_TRAFFIC : next;
			}
		}
	}
}

/**
 * Vertical legs from (rx, ry): in the column at offset e, the road tile v
 * rows from home is crossed by every target in that column at vertical
 * distance >= v (diamond-limited to RADIUS - |e|), at step value |e| + v —
 * so sweep v downward accumulating the count of targets passed.
 */
function spreadVertical(
	state: CityState,
	rx: number,
	ry: number,
	load: number,
): void {
	const { width, height, roads, traffic } = state;
	const valBase = load * RADIUS;

	for (let e = -RADIUS; e <= RADIUS; e++) {
		const cx = rx + e;
		if (cx < 0 || cx >= width) continue;
		const ae = e < 0 ? -e : e;
		const maxV = RADIUS - ae;
		if (maxV < 1) continue;

		for (let dir = -1; dir <= 1; dir += 2) {
			let trips = 0;
			for (let v = maxV; v >= 1; v--) {
				const ty = ry + dir * v;
				if (ty < 0 || ty >= height) continue;

				const ti = ty * width + cx;
				trips += jobFlags[ti] ?? 0;
				if (trips === 0) continue;

				if (roads[ti] === 1) {
					const add = (STEP_VALUES[valBase + ae + v - 1] ?? 1) * trips;
					const next = (traffic[ti] ?? 0) + add;
					traffic[ti] = next > MAX_TRAFFIC ? MAX_TRAFFIC : next;
				}
			}
		}
	}
}
