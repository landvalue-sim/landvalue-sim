/**
 * Preview painting — maps a generated city's terrain layers to RGBA pixels
 * for the New City preview. Water shades darker with depth; land shades from
 * lowland green up to a pale greenish gray at the peaks. Pure data transform,
 * kept separate from the worker entry so it can be unit-tested.
 */

import {
	type CityState,
	GEN_LAND_RELIEF,
	SEA_LEVEL,
	TERRAIN_WATER,
} from "../sim/index.ts";

// Land elevation spans SEA_LEVEL..SEA_LEVEL + 1 + GEN_LAND_RELIEF (see
// terrain-gen), so normalize land shading over that relief range.
const LAND_RELIEF_SPAN = GEN_LAND_RELIEF + 1;

function lerpChannel(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

/** Write one water pixel: shallow #3b82f6 down to deep #172554 by depth. */
function paintWater(
	out: Uint8ClampedArray,
	offset: number,
	depth: number,
): void {
	out[offset] = lerpChannel(59, 23, depth);
	out[offset + 1] = lerpChannel(130, 37, depth);
	out[offset + 2] = lerpChannel(246, 84, depth);
	out[offset + 3] = 255;
}

/** Write one land pixel: lowland green rising to pale greenish gray peaks. */
function paintLand(out: Uint8ClampedArray, offset: number, t: number): void {
	let r = 0;
	let g = 0;
	let b = 0;
	if (t < 0.55) {
		const u = t / 0.55;
		r = lerpChannel(63, 132, u);
		g = lerpChannel(98, 155, u);
		b = lerpChannel(18, 74, u);
	} else {
		const u = (t - 0.55) / 0.45;
		r = lerpChannel(132, 222, u);
		g = lerpChannel(155, 227, u);
		b = lerpChannel(74, 213, u);
	}
	out[offset] = r;
	out[offset + 1] = g;
	out[offset + 2] = b;
	out[offset + 3] = 255;
}

/**
 * Paint the city's terrain into `out` (RGBA, `city.size * 4` bytes), one
 * pixel per tile in row-major order.
 */
export function paintPreviewPixels(
	city: CityState,
	out: Uint8ClampedArray,
): void {
	console.assert(out.length === city.size * 4, "preview pixel buffer size");
	const { size, terrain, elevation } = city;

	for (let i = 0; i < size; i++) {
		const offset = i * 4;
		const elev = elevation[i] ?? 0;
		if ((terrain[i] ?? 0) === TERRAIN_WATER) {
			const depth = Math.min(1, Math.max(0, (SEA_LEVEL - elev) / SEA_LEVEL));
			paintWater(out, offset, depth);
		} else {
			const t = Math.min(1, Math.max(0, (elev - SEA_LEVEL) / LAND_RELIEF_SPAN));
			paintLand(out, offset, t);
		}
	}
}
