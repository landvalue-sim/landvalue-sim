/**
 * Undo — a ring of city snapshots, one per player edit.
 *
 * What a snapshot holds is deliberately narrow: the whole grid (every tile
 * layer plus the vertex heights, which the byte layout keeps in one unbroken
 * run — see `gridByteRange`) and the finance aggregates the player moves
 * directly. It does *not* hold the clock, the demand curves, or the PRNG
 * stream, so undoing a misplaced road rewinds the road and refunds its cost
 * without rewinding the calendar or re-rolling the simulation's random
 * sequence. Derived layers ride along in the grid copy; they are recomputed
 * from the restored grid anyway (see `refreshDerived`).
 *
 * Every slot is allocated up front (NASA rule 3): capturing and restoring are
 * a single typed-array copy each, with no allocation on the edit path. Depth
 * is whatever fits UNDO_MEMORY_BUDGET at this map size, so a 64x64 map keeps a
 * long history and a 256x256 one still keeps a useful few.
 */

import { type CityState, gridByteRange } from "./city-state.ts";
import { AGG, MAX_BONDS } from "./constants.ts";
import { invariant } from "./invariant.ts";

/** Ceiling on total snapshot memory, across all slots. */
const UNDO_MEMORY_BUDGET = 16 * 1024 * 1024;
const MIN_UNDO_DEPTH = 8;
const MAX_UNDO_DEPTH = 32;

/**
 * Aggregates a snapshot carries. Treasury so an undo refunds what the edit
 * cost; the bond slots and payment so undoing a bond issue takes back the
 * proceeds *and* the debt. Tax rates are deliberately absent — a rate is a
 * standing policy, not an edit, and should survive an undo of the map.
 */
const SNAPSHOT_AGGREGATES: ReadonlyArray<number> = buildSnapshotAggregates();

function buildSnapshotAggregates(): ReadonlyArray<number> {
	const list: number[] = [AGG.TREASURY, AGG.BOND_PAYMENT];
	for (let i = 0; i < MAX_BONDS; i++) list.push(AGG.BOND_SLOT_0 + i);
	return list;
}

export interface UndoRing {
	/** Grid bytes per stored snapshot, one entry per slot. */
	readonly slots: ReadonlyArray<Uint8Array>;
	/** Snapshotted aggregates, SNAPSHOT_AGGREGATES.length per slot. */
	readonly aggregates: Float64Array;
	/** View of the live city's grid bytes — the copy source and destination. */
	readonly grid: Uint8Array;
	readonly depth: number;
	/** Slot the next capture writes into. */
	head: number;
	/** Snapshots available to restore (0..depth). */
	count: number;
}

/** How many snapshots of `snapshotBytes` each the memory budget allows. */
function ringDepth(snapshotBytes: number): number {
	const fit = Math.floor(UNDO_MEMORY_BUDGET / snapshotBytes);
	return Math.max(MIN_UNDO_DEPTH, Math.min(MAX_UNDO_DEPTH, fit));
}

/** Allocate an undo ring sized for `state`'s grid. Call once, at startup. */
export function createUndoRing(state: CityState): UndoRing {
	const range = gridByteRange(state.width, state.height);
	const depth = ringDepth(range.byteLength);
	const slots: Uint8Array[] = [];
	for (let i = 0; i < depth; i++) {
		slots.push(new Uint8Array(range.byteLength));
	}
	return {
		slots,
		aggregates: new Float64Array(depth * SNAPSHOT_AGGREGATES.length),
		grid: new Uint8Array(state.buffer, range.byteOffset, range.byteLength),
		depth,
		head: 0,
		count: 0,
	};
}

/**
 * Stage the city's current state into the next slot *without* claiming it.
 * Call before applying an edit; call `commitUndo` afterwards only if the edit
 * changed something, so a no-op drag does not push an undo step that appears
 * to do nothing when used.
 */
export function captureUndo(ring: UndoRing, state: CityState): void {
	const slot = ring.slots[ring.head];
	invariant(slot !== undefined, "undo ring head out of range");
	slot.set(ring.grid);

	const base = ring.head * SNAPSHOT_AGGREGATES.length;
	for (let i = 0; i < SNAPSHOT_AGGREGATES.length; i++) {
		const agg = SNAPSHOT_AGGREGATES[i] ?? 0;
		ring.aggregates[base + i] = state.aggregates[agg] ?? 0;
	}
}

/** Keep the staged snapshot, dropping the oldest one once the ring is full. */
export function commitUndo(ring: UndoRing): void {
	ring.head = (ring.head + 1) % ring.depth;
	if (ring.count < ring.depth) ring.count++;
}

/**
 * Restore the most recent snapshot into `state`. Returns false when the ring
 * is empty. The caller is responsible for recomputing derived layers.
 */
export function restoreUndo(ring: UndoRing, state: CityState): boolean {
	if (ring.count === 0) return false;

	ring.head = (ring.head + ring.depth - 1) % ring.depth;
	ring.count--;

	const slot = ring.slots[ring.head];
	invariant(slot !== undefined, "undo ring head out of range");
	ring.grid.set(slot);

	const base = ring.head * SNAPSHOT_AGGREGATES.length;
	for (let i = 0; i < SNAPSHOT_AGGREGATES.length; i++) {
		const agg = SNAPSHOT_AGGREGATES[i] ?? 0;
		state.aggregates[agg] = ring.aggregates[base + i] ?? 0;
	}
	return true;
}

/** Drop the whole history — the city underneath it no longer exists. */
export function clearUndo(ring: UndoRing): void {
	ring.head = 0;
	ring.count = 0;
}
