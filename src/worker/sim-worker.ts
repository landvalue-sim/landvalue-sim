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
 */

/// <reference lib="webworker" />

import type {
	ClearViolationsMessage,
	CommandsMessage,
	FromWorkerMessage,
	InitMessage,
	SpeedMessage,
	ToWorkerMessage,
} from "../app/protocol.ts";
import type { Speed } from "../app/types.ts";
import type { Command } from "../sim/commands.ts";
import {
	type CityState,
	clearViolations,
	getProfileSnapshot,
	getViolations,
	tick,
	viewCity,
} from "../sim/index.ts";

// Milliseconds per sim tick at each speed level (index = speed). 0 = paused.
const TICK_INTERVALS: readonly [number, number, number, number] = [
	0, 250, 83, 33,
];
const MAX_TICKS_PER_STEP = 10;
const DRIVER_INTERVAL_MS = 16; // ~60 Hz accumulator cadence
const STATS_INTERVAL_MS = 200; // dev panel refresh cadence

const ctx = self as DedicatedWorkerGlobalScope;

// ---- Mutable worker state (single owner, this thread only) -----------------

let city: CityState | null = null;
let speed: Speed = 1;
let accumulator = 0;
let lastTime = 0;
let lastStatsTime = 0;
const pendingCommands: Command[] = [];

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
	}
});

function handleInit(msg: InitMessage): void {
	city = viewCity(msg.buffer, msg.width, msg.height);
	accumulator = 0;
	lastTime = performance.now();
	lastStatsTime = lastTime;
	ctx.setInterval(drive, DRIVER_INTERVAL_MS);
	post({ type: "ready" });
}

function handleCommands(msg: CommandsMessage): void {
	for (const cmd of msg.commands) {
		pendingCommands.push(cmd);
	}
	// Apply immediately so zoning/roads appear even while paused.
	if (speed === 0 && city !== null && pendingCommands.length > 0) {
		stepOnce();
	}
}

function handleSpeed(msg: SpeedMessage): void {
	speed = msg.speed;
	accumulator = 0;
	lastTime = performance.now();
}

function handleClearViolations(_msg: ClearViolationsMessage): void {
	clearViolations();
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

/** Run exactly one tick, draining any queued commands into it. */
function stepOnce(): void {
	if (city === null) return;
	if (pendingCommands.length > 0) {
		const batch = pendingCommands.slice();
		pendingCommands.length = 0;
		tick(city, batch);
	} else {
		tick(city, EMPTY_COMMANDS);
	}
}

const EMPTY_COMMANDS: ReadonlyArray<Command> = [];

function post(msg: FromWorkerMessage): void {
	ctx.postMessage(msg);
}
