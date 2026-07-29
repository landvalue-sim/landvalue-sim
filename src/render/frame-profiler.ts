/**
 * Frame profiler — rolling window of render-loop frame timings, the main-thread
 * counterpart to the worker's tick profiler (`sim/profiler.ts`).
 *
 * Two numbers are recorded per frame: the *period* between consecutive frames
 * (the reciprocal of which is the FPS the player actually sees) and the *work*
 * the scene's `update()` does inside that frame. A low FPS with low work time
 * means something outside the scene is the bottleneck (GPU, browser, another
 * tab); a low FPS with high work time points at the bake path.
 *
 * Both buffers are pre-allocated typed arrays and nothing here allocates per
 * frame. The recorders take explicit timestamps rather than reading the clock
 * themselves so the window maths is deterministically testable; callers guard
 * the calls with `import.meta.env.DEV` so production builds drop them entirely.
 */

// ---- Rolling window ---------------------------------------------------------

/** ~2 seconds at 60fps — matches the sim profiler's window. */
const WINDOW_SIZE = 120;

/** Frame periods (ms) — time between the starts of consecutive frames. */
const periods = new Float64Array(WINDOW_SIZE);

/** Scene update durations (ms) — work done inside the frame. */
const work = new Float64Array(WINDOW_SIZE);

let cursor = 0;
let sampleCount = 0;

/** Timestamp the current frame began, and whether a previous frame exists. */
let frameStart = 0;
let hasPrevFrame = false;

// ---- Public API -------------------------------------------------------------

export interface FrameStats {
	/** Frames per second over the window, from the mean frame period. */
	readonly fps: number;
	/** Worst frame in the window expressed as FPS (i.e. from the max period). */
	readonly minFps: number;
	/** Most recent frame period, ms. */
	readonly lastPeriod: number;
	/** Mean frame period, ms. */
	readonly avgPeriod: number;
	/** Longest frame period in the window, ms. */
	readonly maxPeriod: number;
	/** Most recent scene update duration, ms. */
	readonly lastWork: number;
	/** Mean scene update duration, ms. */
	readonly avgWork: number;
	/** Longest scene update duration in the window, ms. */
	readonly maxWork: number;
	readonly sampleCount: number;
}

const EMPTY_STATS: FrameStats = {
	fps: 0,
	minFps: 0,
	lastPeriod: 0,
	avgPeriod: 0,
	maxPeriod: 0,
	lastWork: 0,
	avgWork: 0,
	maxWork: 0,
	sampleCount: 0,
};

/**
 * Call at the top of the scene's `update()`. `time` is the frame timestamp
 * Phaser hands the scene. The first frame only seeds the clock — there is no
 * previous frame to measure a period against.
 */
export function frameProfilerBegin(time: number): void {
	if (hasPrevFrame) {
		periods[cursor] = time - frameStart;
	}
	frameStart = time;
	hasPrevFrame = true;
}

/**
 * Call at the end of the scene's `update()` with the current clock reading.
 * Commits this frame's sample and advances the ring buffer.
 */
export function frameProfilerEnd(time: number): void {
	work[cursor] = time - frameStart;
	cursor = (cursor + 1) % WINDOW_SIZE;
	if (sampleCount < WINDOW_SIZE) sampleCount++;
}

/** Discard all recorded samples (used by tests and on scene teardown). */
export function frameProfilerReset(): void {
	periods.fill(0);
	work.fill(0);
	cursor = 0;
	sampleCount = 0;
	frameStart = 0;
	hasPrevFrame = false;
}

/**
 * Read the current window. The seed frame carries no period, so a single
 * sample reports work only and leaves the rate at zero until a second frame
 * lands.
 */
export function getFrameStats(): FrameStats {
	if (sampleCount === 0) return EMPTY_STATS;

	const lastIdx = (cursor - 1 + WINDOW_SIZE) % WINDOW_SIZE;
	let periodSum = 0;
	let periodCount = 0;
	let maxPeriod = 0;
	let workSum = 0;
	let maxWork = 0;

	for (let i = 0; i < sampleCount; i++) {
		// A zero period is the seed frame (or a reset slot), not a real 0ms
		// frame — averaging it in would inflate the reported rate.
		const p = periods[i] ?? 0;
		if (p > 0) {
			periodSum += p;
			periodCount++;
			if (p > maxPeriod) maxPeriod = p;
		}
		const w = work[i] ?? 0;
		workSum += w;
		if (w > maxWork) maxWork = w;
	}

	const avgPeriod = periodCount > 0 ? periodSum / periodCount : 0;
	return {
		fps: avgPeriod > 0 ? 1000 / avgPeriod : 0,
		minFps: maxPeriod > 0 ? 1000 / maxPeriod : 0,
		lastPeriod: periods[lastIdx] ?? 0,
		avgPeriod,
		maxPeriod,
		lastWork: work[lastIdx] ?? 0,
		avgWork: sampleCount > 0 ? workSum / sampleCount : 0,
		maxWork,
		sampleCount,
	};
}
