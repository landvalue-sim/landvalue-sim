/**
 * Externalities — pollution spread from industrial zones and power plants.
 *
 * Industrial tiles emit pollution that decays with distance. Coal power
 * plants also emit pollution. Traffic contributes additional pollution
 * scaled by TRAFFIC_POLLUTION_FACTOR.
 *
 * Every source of a given kind adds the same fixed pattern of values — the
 * (2R+1)^2 square window of floor(amount * POLLUTION_DECAY^(|dx|+|dy|)) — so
 * the per-tile arithmetic is precomputed once per kind into a kernel at
 * module load, with per-row spans that skip the corner entries that decay to
 * zero. Sources far enough from the map edge (the overwhelming majority)
 * take a fast path with no bounds checks. Saturating addition of the same
 * non-negative contributions in any order yields identical results, so the
 * output matches the original per-tile scatter exactly (issue #11 — see the
 * golden pin in externalities.test.ts).
 */

import type { CityState } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	CIVIC_TYPE_COUNT,
	MAX_POLLUTION,
	POLLUTION_DECAY,
	POLLUTION_PER_INDUSTRIAL,
	POLLUTION_SPREAD_RADIUS,
	POWER_PLANT_POLLUTION,
	TRAFFIC_POLLUTION_FACTOR,
	ZONE_INDUSTRIAL,
} from "../constants.ts";
import { invariant } from "../invariant.ts";

const RADIUS = POLLUTION_SPREAD_RADIUS;
const KERNEL_SPAN = 2 * RADIUS + 1;

// The contribution table only shrinks with distance while decay <= 1; a
// larger decay would make the fixed square window silently understate the
// spread. Check once at module load so a retune fails loudly.
invariant(
	POLLUTION_DECAY > 0 && POLLUTION_DECAY <= 1,
	"externalities: POLLUTION_DECAY outside (0, 1] breaks the kernel window",
);

/**
 * The fixed pattern one source adds: `values` holds the (2R+1)^2 window in
 * row-major order, and lo/hi give each row's first and last nonzero column
 * so the add loops skip the corners where the contribution floors to zero.
 * A row with no nonzero entries has lo > hi and is skipped entirely.
 */
interface PollutionKernel {
	readonly values: Int32Array;
	readonly lo: Int8Array;
	readonly hi: Int8Array;
}

function buildKernel(amount: number): PollutionKernel {
	const values = new Int32Array(KERNEL_SPAN * KERNEL_SPAN);
	const lo = new Int8Array(KERNEL_SPAN);
	const hi = new Int8Array(KERNEL_SPAN);
	for (let ky = 0; ky < KERNEL_SPAN; ky++) {
		let first = KERNEL_SPAN;
		let last = -1;
		for (let kx = 0; kx < KERNEL_SPAN; kx++) {
			const dist = Math.abs(kx - RADIUS) + Math.abs(ky - RADIUS);
			// The exact expression the direct scatter used at each distance.
			const v =
				dist === 0 ? amount : Math.floor(amount * POLLUTION_DECAY ** dist);
			values[ky * KERNEL_SPAN + kx] = v;
			if (v > 0) {
				if (kx < first) first = kx;
				last = kx;
			}
		}
		lo[ky] = first;
		hi[ky] = last;
	}
	return { values, lo, hi };
}

const INDUSTRIAL_KERNEL = buildKernel(POLLUTION_PER_INDUSTRIAL);

// One kernel per polluting civic type; null for types that emit nothing.
const PLANT_KERNELS: ReadonlyArray<PollutionKernel | null> = (() => {
	const kernels: Array<PollutionKernel | null> = [];
	for (let c = 0; c < CIVIC_TYPE_COUNT; c++) {
		const amount = POWER_PLANT_POLLUTION[c] ?? 0;
		kernels.push(amount > 0 ? buildKernel(amount) : null);
	}
	return kernels;
})();

export function updateExternalities(state: CityState): void {
	const { width, height, size, zoning, building, civic, traffic, pollution } =
		state;
	// Hoisted imported constants: under Vite's dev/test module transform an
	// imported binding is a namespace property read on every use, which is
	// ruinous inside per-tile loops. Locals compile to registers everywhere.
	const zoneI = ZONE_INDUSTRIAL;
	const empty = BUILDING_EMPTY;
	const trafficFactor = TRAFFIC_POLLUTION_FACTOR;
	const cap = MAX_POLLUTION;

	// Reset pollution field
	pollution.fill(0);

	// For each occupied industrial tile, spread pollution
	for (let i = 0; i < size; i++) {
		if (zoning[i] === zoneI && building[i] !== empty) {
			spreadKernel(width, height, pollution, i, INDUSTRIAL_KERNEL);
		}
	}

	// For each polluting civic building (e.g. coal plant), spread pollution
	for (let i = 0; i < size; i++) {
		const kernel = PLANT_KERNELS[civic[i] ?? 0];
		if (kernel !== undefined && kernel !== null) {
			spreadKernel(width, height, pollution, i, kernel);
		}
	}

	// Traffic contributes to pollution on road tiles
	for (let i = 0; i < size; i++) {
		const t = traffic[i] ?? 0;
		if (t > 0) {
			const trafficPol = Math.floor(t * trafficFactor);
			if (trafficPol > 0) {
				const next = (pollution[i] ?? 0) + trafficPol;
				pollution[i] = next > cap ? cap : next;
			}
		}
	}
}

/** Saturating-add a source's kernel into the pollution field. */
function spreadKernel(
	width: number,
	height: number,
	pollution: Uint8Array,
	sourceIdx: number,
	kernel: PollutionKernel,
): void {
	const cx = sourceIdx % width;
	const cy = (sourceIdx - cx) / width;
	const { values, lo, hi } = kernel;
	const cap = MAX_POLLUTION;

	if (
		cx >= RADIUS &&
		cx < width - RADIUS &&
		cy >= RADIUS &&
		cy < height - RADIUS
	) {
		// Interior source: the whole window is in bounds, no checks needed.
		for (let ky = 0; ky < KERNEL_SPAN; ky++) {
			const rowBase = (cy + ky - RADIUS) * width + cx - RADIUS;
			const kBase = ky * KERNEL_SPAN;
			const last = hi[ky] ?? -1;
			for (let kx = lo[ky] ?? KERNEL_SPAN; kx <= last; kx++) {
				const ti = rowBase + kx;
				const next = (pollution[ti] ?? 0) + (values[kBase + kx] ?? 0);
				pollution[ti] = next > cap ? cap : next;
			}
		}
		return;
	}

	// Edge source: clamp each row and column to the map.
	for (let ky = 0; ky < KERNEL_SPAN; ky++) {
		const ny = cy + ky - RADIUS;
		if (ny < 0 || ny >= height) continue;
		const rowBase = ny * width + cx - RADIUS;
		const kBase = ky * KERNEL_SPAN;
		const last = hi[ky] ?? -1;
		for (let kx = lo[ky] ?? KERNEL_SPAN; kx <= last; kx++) {
			const nx = cx + kx - RADIUS;
			if (nx < 0 || nx >= width) continue;
			const ti = rowBase + kx;
			const next = (pollution[ti] ?? 0) + (values[kBase + kx] ?? 0);
			pollution[ti] = next > cap ? cap : next;
		}
	}
}
