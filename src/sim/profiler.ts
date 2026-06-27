/**
 * Tick profiler — measures per-system execution time over a rolling window.
 *
 * All timing is gated behind `import.meta.env.DEV` so production builds
 * see zero overhead (Vite dead-code-eliminates the branches).
 */

// ---- System names (must match tick pipeline order) --------------------------

export const SYSTEM_NAMES = [
	"commands",
	"rciDemand",
	"landValue",
	"migration",
	"externalities",
	"publicFinance",
	"invariants",
] as const;

export type SystemName = (typeof SYSTEM_NAMES)[number];

const SYSTEM_COUNT = SYSTEM_NAMES.length;

// ---- Rolling window stats ---------------------------------------------------

const WINDOW_SIZE = 120; // ~2 seconds at 60fps

// Per-system circular buffers of recent timings (ms)
const buffers: Float64Array[] = [];
for (let i = 0; i < SYSTEM_COUNT; i++) {
	buffers.push(new Float64Array(WINDOW_SIZE));
}

// Total tick time buffer
const tickBuffer = new Float64Array(WINDOW_SIZE);

let cursor = 0;
let sampleCount = 0;

// Scratch space for the current tick's timings
const currentTimings = new Float64Array(SYSTEM_COUNT);
let tickStart = 0;

// ---- Public API -------------------------------------------------------------

export interface SystemStats {
	readonly last: number;
	readonly avg: number;
	readonly min: number;
	readonly max: number;
}

export interface ProfileSnapshot {
	readonly systems: ReadonlyMap<SystemName, SystemStats>;
	readonly totalTick: SystemStats;
	readonly sampleCount: number;
}

/** Call at the start of a tick. */
export function profilerTickStart(): void {
	if (import.meta.env.DEV) {
		tickStart = performance.now();
	}
}

/** Call before a system runs. Returns a token to pass to systemEnd. */
export function profilerSystemStart(): number {
	if (import.meta.env.DEV) {
		return performance.now();
	}
	return 0;
}

/** Call after a system runs. */
export function profilerSystemEnd(
	systemIndex: number,
	startTime: number,
): void {
	if (import.meta.env.DEV) {
		currentTimings[systemIndex] = performance.now() - startTime;
	}
}

/** Call at the end of a tick to commit timings. */
export function profilerTickEnd(): void {
	if (import.meta.env.DEV) {
		const totalTime = performance.now() - tickStart;
		tickBuffer[cursor] = totalTime;

		for (let i = 0; i < SYSTEM_COUNT; i++) {
			const buf = buffers[i];
			if (buf !== undefined) {
				buf[cursor] = currentTimings[i] ?? 0;
			}
			currentTimings[i] = 0;
		}

		cursor = (cursor + 1) % WINDOW_SIZE;
		if (sampleCount < WINDOW_SIZE) {
			sampleCount++;
		}
	}
}

/** Read current profiling stats. */
export function getProfileSnapshot(): ProfileSnapshot {
	const systems = new Map<SystemName, SystemStats>();

	for (let i = 0; i < SYSTEM_COUNT; i++) {
		const name = SYSTEM_NAMES[i];
		const buf = buffers[i];
		if (name !== undefined && buf !== undefined) {
			systems.set(name, computeStats(buf, sampleCount));
		}
	}

	return {
		systems,
		totalTick: computeStats(tickBuffer, sampleCount),
		sampleCount,
	};
}

/** Index of a system name, for use with profilerSystemEnd. */
export function systemIndex(name: SystemName): number {
	for (let i = 0; i < SYSTEM_COUNT; i++) {
		if (SYSTEM_NAMES[i] === name) return i;
	}
	return 0;
}

// ---- Helpers ----------------------------------------------------------------

function computeStats(buf: Float64Array, count: number): SystemStats {
	if (count === 0) {
		return { last: 0, avg: 0, min: 0, max: 0 };
	}

	const lastIdx = (cursor - 1 + WINDOW_SIZE) % WINDOW_SIZE;
	const last = buf[lastIdx] ?? 0;

	let sum = 0;
	let min = Number.MAX_VALUE;
	let max = 0;

	for (let i = 0; i < count; i++) {
		const v = buf[i] ?? 0;
		sum += v;
		if (v < min) min = v;
		if (v > max) max = v;
	}

	return {
		last,
		avg: sum / count,
		min,
		max,
	};
}
