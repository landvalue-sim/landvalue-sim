/**
 * Simulation worker — owns the deterministic tick loop off the main thread.
 *
 * It adopts the `SharedArrayBuffer` allocated by the main thread, constructs a
 * `CityState` view over it, and advances the sim. The render shell reads the
 * same buffer on the main thread, zero-copy. Player commands and speed changes
 * arrive as messages; in dev builds the worker posts profiler + violation
 * snapshots back for the dev panel.
 *
 * No `requestAnimationFrame` exists in a worker, so a fixed-cadence
 * `setInterval` accumulates real elapsed time and steps the sim at the rate the
 * current speed dictates — mirroring a fixed-timestep accumulator loop.
 *
 * Player edits do not ride the tick loop. They are applied the moment they
 * arrive, via `applyEdits`, which runs the command processor and recomputes the
 * grid-derived layers but advances nothing: no growth, no taxes, no calendar.
 * Between two ticks nothing else can run on this thread, so that is equivalent
 * to the tick applying them — and it means a paused city stays paused no matter
 * how much the player builds. Each batch is bracketed by an undo snapshot.
 */

/// <reference lib="webworker" />

import type {
	ClearViolationsMessage,
	CommandsMessage,
	FromWorkerMessage,
	InitMessage,
	SetInfiniteMoneyMessage,
	SpeedMessage,
	ToWorkerMessage,
	UndoMessage,
} from "../app/protocol.ts";
import type { Speed } from "../app/types.ts";
import {
	AGG,
	applyEdits,
	buildTestCity,
	bumpRevision,
	type CityState,
	captureUndo,
	clearUndo,
	clearViolations,
	commitUndo,
	createUndoRing,
	getProfileSnapshot,
	getViolations,
	INFINITE_TREASURY,
	refreshDerived,
	restoreUndo,
	tick,
	type UndoRing,
	viewCity,
} from "../sim/index.ts";

// Milliseconds per sim tick at each speed level (index = speed). 0 = paused.
// Index 4 (Normal) keeps the historical 250 ms cadence; 7 (Fastest) runs the
// sim about as fast as the ~60 Hz driver allows ("real time").
// slowest, slower, slow, normal, fast, faster, fastest
const TICK_INTERVALS: readonly number[] = [0, 1200, 700, 450, 250, 130, 60, 20];
const MAX_TICKS_PER_STEP = 10;
const DRIVER_INTERVAL_MS = 16; // ~60 Hz accumulator cadence
const STATS_INTERVAL_MS = 200; // dev panel refresh cadence

const ctx = self as DedicatedWorkerGlobalScope;

// ---- Mutable worker state (single owner, this thread only) -----------------

let city: CityState | null = null;
let undoRing: UndoRing | null = null;
let speed: Speed = 4; // Normal
let accumulator = 0;
let lastTime = 0;
let lastStatsTime = 0;

// ---- Message handling ------------------------------------------------------

ctx.addEventListener("message", (event: MessageEvent<ToWorkerMessage>) => {
	const msg = event.data;
	switch (msg.type) {
		case "init":
			handleInit(msg);
			break;
		case "commands":
			handleCommands(msg);
			break;
		case "speed":
			handleSpeed(msg);
			break;
		case "clear-violations":
			handleClearViolations(msg);
			break;
		case "load-test-city":
			handleLoadTestCity();
			break;
		case "set-infinite-money":
			handleSetInfiniteMoney(msg);
			break;
		case "undo":
			handleUndo(msg);
			break;
	}
});

function handleInit(msg: InitMessage): void {
	city = viewCity(msg.buffer, msg.width, msg.height);
	undoRing = createUndoRing(city);
	accumulator = 0;
	lastTime = performance.now();
	lastStatsTime = lastTime;
	ctx.setInterval(drive, DRIVER_INTERVAL_MS);
	post({ type: "ready" });
	postUndoDepth();
}

/**
 * Apply an edit batch immediately, bracketed by an undo snapshot. The snapshot
 * is staged before the batch and kept only if the batch changed something, so a
 * drag that lands entirely on tiles that already hold what it would place never
 * costs the player an undo step.
 */
function handleCommands(msg: CommandsMessage): void {
	if (city === null || undoRing === null) return;
	captureUndo(undoRing, city);
	const changed = applyEdits(city, msg.commands);
	if (changed > 0) {
		commitUndo(undoRing);
		postUndoDepth();
	}
}

function handleUndo(_msg: UndoMessage): void {
	if (city === null || undoRing === null) return;
	if (!restoreUndo(undoRing, city)) return;
	// The snapshot carries the grid; the coverage and value layers on top of it
	// are recomputed rather than trusted. The revision only ever moves forward —
	// rolling it back would leave the render cache thinking it is current.
	refreshDerived(city);
	bumpRevision(city);
	postUndoDepth();
}

function handleSpeed(msg: SpeedMessage): void {
	speed = msg.speed;
	accumulator = 0;
	lastTime = performance.now();
}

function handleClearViolations(_msg: ClearViolationsMessage): void {
	clearViolations();
}

function handleLoadTestCity(): void {
	if (city === null || undoRing === null) return;
	buildTestCity(city);
	// The city those snapshots describe no longer exists.
	clearUndo(undoRing);
	accumulator = 0;
	lastTime = performance.now();
	// Run one tick so land value, totals, and the finance breakdown are
	// populated immediately, even if the sim is paused.
	stepOnce();
	postUndoDepth();
}

function handleSetInfiniteMoney(msg: SetInfiniteMoneyMessage): void {
	if (city === null) return;
	city.aggregates[AGG.DEBUG_INFINITE_MONEY] = msg.enabled ? 1 : 0;
	// Top up immediately so the change shows even while the sim is paused; the
	// flag keeps it pinned on every subsequent tick.
	if (msg.enabled) city.aggregates[AGG.TREASURY] = INFINITE_TREASURY;
}

// ---- Tick driver -----------------------------------------------------------

function drive(): void {
	if (city === null) return;

	const now = performance.now();
	const dt = now - lastTime;
	lastTime = now;

	const interval = TICK_INTERVALS[speed] ?? 0;
	if (interval > 0) {
		accumulator += dt;
		let steps = 0;
		while (accumulator >= interval && steps < MAX_TICKS_PER_STEP) {
			stepOnce();
			accumulator -= interval;
			steps++;
		}
	}

	if (import.meta.env.DEV && now - lastStatsTime >= STATS_INTERVAL_MS) {
		lastStatsTime = now;
		post({
			type: "stats",
			profile: getProfileSnapshot(),
			violations: getViolations().slice(),
		});
	}
}

/** Run exactly one tick. Player commands are applied on arrival, not here. */
function stepOnce(): void {
	if (city === null) return;
	tick(city, EMPTY_COMMANDS);
}

const EMPTY_COMMANDS: ReadonlyArray<never> = [];

function postUndoDepth(): void {
	post({ type: "undo-depth", depth: undoRing?.count ?? 0 });
}

function post(msg: FromWorkerMessage): void {
	ctx.postMessage(msg);
}
