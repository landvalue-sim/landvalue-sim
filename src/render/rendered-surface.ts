/**
 * RenderedSurface — the bake's record of what it actually drew.
 *
 * Each world bake writes, per tile, the four corner lifts (world px, in
 * N/E/S/W order) of the face that ended up on screen: the sloped terrain
 * face, the graded road surface, the flat water plane, or the top of a value
 * column in a column overlay. Dynamic UI (hover cursor, drag preview) reads
 * this record instead of re-deriving overlay-specific geometry, so the
 * highlight always matches the pixels on screen — the draw code is the single
 * source of truth for surface shape.
 *
 * Validity is a per-tile generation stamp: a tile is readable only if it was
 * recorded during the current bake generation. Bumping the generation
 * invalidates every tile in O(1), so a bake that culls to the view leaves
 * off-screen tiles unreadable rather than stale. Readers fall back to
 * deriving geometry themselves when a tile is unrecorded.
 *
 * All buffers are pre-allocated at creation; record/read do no allocation.
 */

import { invariant } from "../sim/invariant.ts";

export interface RenderedSurface {
	readonly width: number;
	readonly height: number;
	/** Corner lifts in world px, stride 4 per tile: N, E, S, W. */
	readonly corners: Float32Array;
	/** Bake generation that last recorded each tile. */
	readonly stamps: Uint32Array;
	/** Current bake generation. Tile i is valid iff stamps[i] === generation.
	 *  0 means "no bake yet" — nothing is valid until the first begin. */
	generation: number;
	/** Largest corner lift recorded this generation (world px). Gives
	 *  surface-aware picking a tight upper bound for its top-down march. */
	maxLift: number;
}

// Stamps are Uint32; past this the next increment would alias generation 0
// ("never recorded"), so the stamps reset and the count restarts.
const GENERATION_MAX = 0xffffffff;

export function createRenderedSurface(
	width: number,
	height: number,
): RenderedSurface {
	invariant(
		width > 0 && height > 0,
		"rendered-surface: dimensions must be positive",
	);
	return {
		width,
		height,
		corners: new Float32Array(width * height * 4),
		stamps: new Uint32Array(width * height),
		generation: 0,
		maxLift: 0,
	};
}

/** Start a new bake: invalidates every previously recorded tile in O(1). */
export function beginSurfaceBake(surface: RenderedSurface): void {
	if (surface.generation >= GENERATION_MAX) {
		surface.stamps.fill(0);
		surface.generation = 0;
	}
	surface.generation += 1;
	surface.maxLift = 0;
}

/** Record the on-screen top face of tile `idx` for the current generation. */
export function recordTileFace(
	surface: RenderedSurface,
	idx: number,
	liftN: number,
	liftE: number,
	liftS: number,
	liftW: number,
): void {
	invariant(
		idx >= 0 && idx < surface.stamps.length,
		"rendered-surface: record index out of range",
	);
	const base = idx * 4;
	surface.corners[base] = liftN;
	surface.corners[base + 1] = liftE;
	surface.corners[base + 2] = liftS;
	surface.corners[base + 3] = liftW;
	surface.stamps[idx] = surface.generation;
	if (liftN > surface.maxLift) surface.maxLift = liftN;
	if (liftE > surface.maxLift) surface.maxLift = liftE;
	if (liftS > surface.maxLift) surface.maxLift = liftS;
	if (liftW > surface.maxLift) surface.maxLift = liftW;
}

/**
 * Read tile `idx`'s recorded face into `out[0..3]` (N, E, S, W lifts).
 * Returns false — leaving `out` untouched — if the tile was not recorded
 * during the current bake generation.
 */
export function readTileFace(
	surface: RenderedSurface,
	idx: number,
	out: Float32Array,
): boolean {
	invariant(
		idx >= 0 && idx < surface.stamps.length,
		"rendered-surface: read index out of range",
	);
	invariant(out.length >= 4, "rendered-surface: out buffer too small");
	if (surface.generation === 0 || surface.stamps[idx] !== surface.generation) {
		return false;
	}
	const base = idx * 4;
	out[0] = surface.corners[base] ?? 0;
	out[1] = surface.corners[base + 1] ?? 0;
	out[2] = surface.corners[base + 2] ?? 0;
	out[3] = surface.corners[base + 3] ?? 0;
	return true;
}
