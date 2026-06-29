/**
 * Traffic system — compute per-road-tile congestion from commute volume.
 *
 * Residential tiles generate trips to nearby C/I tiles. Each trip adds load
 * to road tiles along the Manhattan path. Rail tiles absorb some capacity,
 * reducing road congestion. High traffic lowers adjacent land value and
 * contributes to pollution (both handled in their respective systems).
 */

import { type CityState, inBounds } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	MAX_TRAFFIC,
	TRAFFIC_DECAY,
	TRAFFIC_SPREAD_RADIUS,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

export function updateTraffic(state: CityState): void {
	const { width, height, size, zoning, building, roads, rail, traffic } = state;

	// Reset traffic
	traffic.fill(0);

	// Count rail tiles for capacity offset
	let railCount = 0;
	for (let i = 0; i < size; i++) {
		if (rail[i] === 1) railCount++;
	}
	// Rail absorbs some commuter load: each rail tile reduces effective traffic
	const railReduction = Math.min(0.5, railCount * 0.005);

	// For each occupied R tile, find nearby C/I and add traffic to roads between
	for (let i = 0; i < size; i++) {
		if (zoning[i] !== ZONE_RESIDENTIAL || building[i] === BUILDING_EMPTY)
			continue;

		const rx = i % width;
		const ry = (i - rx) / width;
		const density = building[i] ?? 1;

		// Search for nearby job tiles within a radius
		for (let dy = -TRAFFIC_SPREAD_RADIUS; dy <= TRAFFIC_SPREAD_RADIUS; dy++) {
			const ty = ry + dy;
			if (ty < 0 || ty >= height) continue;
			const adx = TRAFFIC_SPREAD_RADIUS - Math.abs(dy);
			for (let dx = -adx; dx <= adx; dx++) {
				const tx = rx + dx;
				if (tx < 0 || tx >= width) continue;
				const ti = ty * width + tx;
				const tz = zoning[ti] ?? 0;
				if (
					(tz === ZONE_COMMERCIAL || tz === ZONE_INDUSTRIAL) &&
					building[ti] !== BUILDING_EMPTY
				) {
					// Add traffic along the Manhattan path
					addTrafficPath(
						width,
						height,
						roads,
						traffic,
						rx,
						ry,
						tx,
						ty,
						density,
						railReduction,
					);
				}
			}
		}
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

function addTrafficPath(
	width: number,
	height: number,
	roads: Uint8Array,
	traffic: Uint8Array,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	density: number,
	railReduction: number,
): void {
	const dist = Math.abs(x1 - x0) + Math.abs(y1 - y0);
	if (dist === 0) return;

	const load = Math.max(1, Math.floor(density * (1 - railReduction)));

	// Walk horizontally first, then vertically
	let cx = x0;
	let cy = y0;
	const sx = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
	const sy = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;

	// Horizontal segment
	for (let step = 0; step < Math.abs(x1 - x0); step++) {
		cx += sx;
		if (inBounds(width, height, cx, cy)) {
			const idx = cy * width + cx;
			if (roads[idx] === 1) {
				const decayed = Math.max(1, Math.floor(load * TRAFFIC_DECAY ** step));
				const current = traffic[idx] ?? 0;
				traffic[idx] = Math.min(MAX_TRAFFIC, current + decayed);
			}
		}
	}

	// Vertical segment
	for (let step = 0; step < Math.abs(y1 - y0); step++) {
		cy += sy;
		if (inBounds(width, height, cx, cy)) {
			const idx = cy * width + cx;
			if (roads[idx] === 1) {
				const totalStep = Math.abs(x1 - x0) + step;
				const decayed = Math.max(
					1,
					Math.floor(load * TRAFFIC_DECAY ** totalStep),
				);
				const current = traffic[idx] ?? 0;
				traffic[idx] = Math.min(MAX_TRAFFIC, current + decayed);
			}
		}
	}
}
