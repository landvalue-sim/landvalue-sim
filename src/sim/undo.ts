/**
 * Undo — a journal of exactly what each player edit changed.
 *
 * An edit is bracketed by `beginStep` / `commitStep`. In between, every write a
 * command makes to player-owned state first records the value it is about to
 * overwrite: `journalTile` for a tile's layers, `journalVertex` for a corner
 * height, `journalCharge` for money spent. Undo replays that step's records
 * newest-first and refunds the charge.
 *
 * Recording deltas rather than snapshotting the map is what keeps undo out of
 * the simulation's way. It writes only the cells the player's edit wrote, so a
 * city that has been ticking since the edit keeps every building that grew,
 * every fire that started and every pound of tax it collected; rolling back a
 * misplaced road puts that one tile back and refunds that one road. Nothing
 * rewinds the sim because nothing writes to it — the clock, the demand curves,
 * the PRNG stream and every untouched tile are simply never addressed.
 *
 * Not everything a command can do is undoable, deliberately. Tax rates are
 * standing policy rather than an edit. A bond is a commitment the simulation
 * has already begun paying down, so unwinding it later would mean rebuilding an
 * amortization the sim has moved past. Both leave the journal empty, which
 * makes their step vanish rather than sit in the history doing nothing.
 *
 * Everything is allocated once, at startup (NASA rule 3): two fixed record
 * arenas used as circular buffers, plus a fixed ring of step descriptors. An
 * edit large enough to lap an arena drops the oldest steps to make room; a
 * single edit larger than a whole arena drops the history entirely rather than
 * leave a half-recorded step that would undo into garbage.
 */

import type { CityState } from "./city-state.ts";
import { AGG } from "./constants.ts";
import { invariant } from "./invariant.ts";

/** Undo steps kept before the oldest falls off the end. */
const MAX_UNDO_STEPS = 32;

/**
 * Records each arena holds, across all steps. A full-grid rectangle drag on the
 * largest supported map is 65536 tiles, so the tile arena holds two of them;
 * terraform drags spend vertex records at a comparable rate. Together the two
 * arenas are a fixed ~3.2 MB regardless of map size.
 *
 * Exported so tests can build histories that lap an arena.
 */
export const TILE_CAPACITY = 1 << 17;
export const VERTEX_CAPACITY = 1 << 17;

/** Per-tile u8 layers stored in one record, in the order `captureTile` writes. */
const TILE_U8_COUNT = 11;

export interface UndoJournal {
	// --- Tile records: one tile's player-owned layers, pre-edit --------------
	readonly tileIdx: Int32Array;
	readonly tileU8: Uint8Array;
	readonly tilePop: Uint16Array;
	readonly tileJobs: Uint16Array;

	// --- Vertex records: one corner height, pre-edit -------------------------
	readonly vertIdx: Int32Array;
	readonly vertH: Uint8Array;

	// --- Step descriptors (a ring of MAX_UNDO_STEPS) -------------------------
	/** Absolute index of the step's first tile record. */
	readonly stepTileFirst: Float64Array;
	readonly stepTileCount: Int32Array;
	/** Absolute index of the step's first vertex record. */
	readonly stepVertFirst: Float64Array;
	readonly stepVertCount: Int32Array;
	/** Money the step spent, refunded when it is undone. */
	readonly stepCharge: Float64Array;

	/**
	 * Total records ever appended. The physical slot is `absolute % CAPACITY`,
	 * so a step's records are intact exactly while `written - first <=
	 * CAPACITY`. Counting rather than tracking spans keeps eviction to one
	 * comparison per step.
	 */
	tileWritten: number;
	vertWritten: number;

	/** Step slot the next commit claims. */
	head: number;
	/** Committed steps available to undo (0..MAX_UNDO_STEPS). */
	count: number;

	/** Whether a step is open. Recording outside one is a programming error. */
	recording: boolean;
	/** Set when the open step lapped an arena and can no longer be replayed. */
	overflowed: boolean;
	tileFirst: number;
	vertFirst: number;
	charge: number;
}

/** Allocate a journal. Call once, at startup. */
export function createUndoJournal(): UndoJournal {
	return {
		tileIdx: new Int32Array(TILE_CAPACITY),
		tileU8: new Uint8Array(TILE_CAPACITY * TILE_U8_COUNT),
		tilePop: new Uint16Array(TILE_CAPACITY),
		tileJobs: new Uint16Array(TILE_CAPACITY),
		vertIdx: new Int32Array(VERTEX_CAPACITY),
		vertH: new Uint8Array(VERTEX_CAPACITY),
		stepTileFirst: new Float64Array(MAX_UNDO_STEPS),
		stepTileCount: new Int32Array(MAX_UNDO_STEPS),
		stepVertFirst: new Float64Array(MAX_UNDO_STEPS),
		stepVertCount: new Int32Array(MAX_UNDO_STEPS),
		stepCharge: new Float64Array(MAX_UNDO_STEPS),
		tileWritten: 0,
		vertWritten: 0,
		head: 0,
		count: 0,
		recording: false,
		overflowed: false,
		tileFirst: 0,
		vertFirst: 0,
		charge: 0,
	};
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/** Open a step. Every journaled write until `commitStep` belongs to it. */
export function beginStep(journal: UndoJournal | null): void {
	if (journal === null) return;
	invariant(!journal.recording, "undo step already open");
	journal.recording = true;
	journal.overflowed = false;
	journal.tileFirst = journal.tileWritten;
	journal.vertFirst = journal.vertWritten;
	journal.charge = 0;
}

/**
 * Close the open step, keeping it only if it recorded something. A batch that
 * changed nothing — a drag across tiles that already hold what it would place,
 * or a tax-rate change, which is not undoable — leaves no step behind, so it
 * can never be "undone" to no visible effect. Returns whether a step was kept.
 */
export function commitStep(journal: UndoJournal | null): boolean {
	if (journal === null) return false;
	invariant(journal.recording, "no undo step open");
	journal.recording = false;

	if (journal.overflowed) {
		// One edit bigger than an arena: its own records have overwritten each
		// other, and the steps beneath it went with them.
		clearJournal(journal);
		return false;
	}

	const tiles = journal.tileWritten - journal.tileFirst;
	const verts = journal.vertWritten - journal.vertFirst;
	if (tiles === 0 && verts === 0 && journal.charge === 0) return false;

	journal.stepTileFirst[journal.head] = journal.tileFirst;
	journal.stepTileCount[journal.head] = tiles;
	journal.stepVertFirst[journal.head] = journal.vertFirst;
	journal.stepVertCount[journal.head] = verts;
	journal.stepCharge[journal.head] = journal.charge;

	journal.head = (journal.head + 1) % MAX_UNDO_STEPS;
	if (journal.count < MAX_UNDO_STEPS) journal.count++;
	return true;
}

/**
 * Record a tile's player-owned layers before a command overwrites them.
 *
 * Derived layers — power, land value, crime, coverage — are deliberately
 * absent. They are pure functions of the grid, so `refreshDerived` rebuilds
 * them after an undo; restoring them from a record would instead reinstate a
 * reading the simulation had already moved past.
 */
export function journalTile(
	journal: UndoJournal | null,
	state: CityState,
	idx: number,
): void {
	if (journal === null) return;
	invariant(journal.recording, "tile journaled outside an undo step");

	const slot = journal.tileWritten % TILE_CAPACITY;
	journal.tileIdx[slot] = idx;
	captureTile(journal, state, idx, slot);
	journal.tileWritten++;
	dropLappedSteps(journal);
}

/** Record a corner height before a terraform edit overwrites it. */
export function journalVertex(
	journal: UndoJournal | null,
	state: CityState,
	v: number,
): void {
	if (journal === null) return;
	invariant(journal.recording, "vertex journaled outside an undo step");

	const slot = journal.vertWritten % VERTEX_CAPACITY;
	journal.vertIdx[slot] = v;
	journal.vertH[slot] = state.vertexHeights[v] ?? 0;
	journal.vertWritten++;
	dropLappedSteps(journal);
}

/**
 * Record money the open step spent, to be refunded if it is undone. A delta
 * rather than the treasury balance: the balance moves with every tax
 * settlement, and an undo has no business reverting those.
 */
export function journalCharge(
	journal: UndoJournal | null,
	amount: number,
): void {
	if (journal === null) return;
	invariant(journal.recording, "charge journaled outside an undo step");
	journal.charge += amount;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Roll back the most recent step: put every recorded cell back and refund what
 * the step spent. Returns false when there is nothing to undo. The caller is
 * responsible for recomputing derived layers.
 */
export function undoStep(journal: UndoJournal, state: CityState): boolean {
	invariant(!journal.recording, "cannot undo while a step is open");
	if (journal.count === 0) return false;

	const step = (journal.head + MAX_UNDO_STEPS - 1) % MAX_UNDO_STEPS;

	// Newest record first, so a cell written twice within the step ends on the
	// value it held before the step began.
	const vertFirst = journal.stepVertFirst[step] ?? 0;
	const vertCount = journal.stepVertCount[step] ?? 0;
	for (let i = vertCount - 1; i >= 0; i--) {
		const slot = (vertFirst + i) % VERTEX_CAPACITY;
		state.vertexHeights[journal.vertIdx[slot] ?? 0] = journal.vertH[slot] ?? 0;
	}

	const tileFirst = journal.stepTileFirst[step] ?? 0;
	const tileCount = journal.stepTileCount[step] ?? 0;
	for (let i = tileCount - 1; i >= 0; i--) {
		const slot = (tileFirst + i) % TILE_CAPACITY;
		restoreTile(journal, state, journal.tileIdx[slot] ?? 0, slot);
	}

	const treasury = state.aggregates[AGG.TREASURY] ?? 0;
	state.aggregates[AGG.TREASURY] = treasury + (journal.stepCharge[step] ?? 0);

	journal.head = step;
	journal.count--;
	return true;
}

/** Drop the whole history — the city underneath it no longer exists. */
export function clearJournal(journal: UndoJournal | null): void {
	if (journal === null) return;
	journal.head = 0;
	journal.count = 0;
	journal.recording = false;
	journal.overflowed = false;
	journal.charge = 0;
	// The arenas need no clearing: no live step refers to them any more, and
	// the absolute counters keep marching, so nothing can alias what came
	// before.
	journal.tileFirst = journal.tileWritten;
	journal.vertFirst = journal.vertWritten;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Retire steps whose records the newest write has just overwritten — oldest
 * first, at most every step, so the loop is bounded (NASA rule 2). An open step
 * that laps an arena eats its own records, which no later undo could replay, so
 * flag it and let `commitStep` discard the history instead.
 */
function dropLappedSteps(journal: UndoJournal): void {
	if (
		journal.tileWritten - journal.tileFirst > TILE_CAPACITY ||
		journal.vertWritten - journal.vertFirst > VERTEX_CAPACITY
	) {
		journal.overflowed = true;
	}

	for (let i = 0; i < MAX_UNDO_STEPS; i++) {
		if (journal.count === 0) return;
		const oldest =
			(journal.head + MAX_UNDO_STEPS - journal.count) % MAX_UNDO_STEPS;
		// A step is judged by where each arena stood when it began, even if it
		// wrote no records there. The `first` marks grow in ring order, so an
		// oldest step that predates a lapped one must go with it — sparing it
		// because it skipped that arena would stop eviction here and leave the
		// lapped step behind it reachable, and undoing that step would replay
		// slots newer writes now own.
		const tileLapped =
			journal.tileWritten - (journal.stepTileFirst[oldest] ?? 0) >
			TILE_CAPACITY;
		const vertLapped =
			journal.vertWritten - (journal.stepVertFirst[oldest] ?? 0) >
			VERTEX_CAPACITY;
		if (!tileLapped && !vertLapped) return;
		journal.count--;
	}
}

/**
 * Copy one tile's player-owned layers into record `slot`. The read order here
 * and the write order in `restoreTile` are the record's format — they must stay
 * in step, and adding a player-writable layer means adding it to both and
 * bumping TILE_U8_COUNT.
 *
 * Nothing in the types enforces that, so `undo.test.ts` does: the "undo tile
 * record format" block round-trips every layer and fails if the two functions
 * or the count drift apart, or if a layer is added to `CityState` without being
 * classified as recorded or derived.
 */
function captureTile(
	journal: UndoJournal,
	state: CityState,
	idx: number,
	slot: number,
): void {
	const base = slot * TILE_U8_COUNT;
	const u8 = journal.tileU8;
	u8[base + 0] = state.terrain[idx] ?? 0;
	u8[base + 1] = state.zoning[idx] ?? 0;
	u8[base + 2] = state.building[idx] ?? 0;
	u8[base + 3] = state.roads[idx] ?? 0;
	u8[base + 4] = state.rail[idx] ?? 0;
	u8[base + 5] = state.powerLines[idx] ?? 0;
	u8[base + 6] = state.civic[idx] ?? 0;
	u8[base + 7] = state.waterPipes[idx] ?? 0;
	u8[base + 8] = state.densityCap[idx] ?? 0;
	u8[base + 9] = state.waterLevel[idx] ?? 0;
	u8[base + 10] = state.elevation[idx] ?? 0;
	journal.tilePop[slot] = state.population[idx] ?? 0;
	journal.tileJobs[slot] = state.jobs[idx] ?? 0;
}

/** Write record `slot` back over tile `idx`. Mirrors `captureTile`. */
function restoreTile(
	journal: UndoJournal,
	state: CityState,
	idx: number,
	slot: number,
): void {
	const base = slot * TILE_U8_COUNT;
	const u8 = journal.tileU8;
	state.terrain[idx] = u8[base + 0] ?? 0;
	state.zoning[idx] = u8[base + 1] ?? 0;
	state.building[idx] = u8[base + 2] ?? 0;
	state.roads[idx] = u8[base + 3] ?? 0;
	state.rail[idx] = u8[base + 4] ?? 0;
	state.powerLines[idx] = u8[base + 5] ?? 0;
	state.civic[idx] = u8[base + 6] ?? 0;
	state.waterPipes[idx] = u8[base + 7] ?? 0;
	state.densityCap[idx] = u8[base + 8] ?? 0;
	state.waterLevel[idx] = u8[base + 9] ?? 0;
	state.elevation[idx] = u8[base + 10] ?? 0;
	state.population[idx] = journal.tilePop[slot] ?? 0;
	state.jobs[idx] = journal.tileJobs[slot] ?? 0;
}
