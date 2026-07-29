import { beforeEach, describe, expect, it } from "vitest";
import {
	frameProfilerBegin,
	frameProfilerEnd,
	frameProfilerReset,
	getFrameStats,
} from "./frame-profiler.ts";

/** Record `count` frames of `period` ms each, doing `work` ms in every one. */
function runFrames(
	startTime: number,
	count: number,
	period: number,
	work: number,
): number {
	let t = startTime;
	for (let i = 0; i < count; i++) {
		frameProfilerBegin(t);
		frameProfilerEnd(t + work);
		t += period;
	}
	return t;
}

describe("frame profiler", () => {
	beforeEach(() => {
		frameProfilerReset();
	});

	it("reports zeroes before any frame is recorded", () => {
		const s = getFrameStats();
		expect(s.sampleCount).toBe(0);
		expect(s.fps).toBe(0);
		expect(s.minFps).toBe(0);
	});

	it("reports work but no rate from a single seed frame", () => {
		frameProfilerBegin(1000);
		frameProfilerEnd(1002);

		const s = getFrameStats();
		expect(s.sampleCount).toBe(1);
		expect(s.lastWork).toBe(2);
		// No previous frame to measure a period against yet.
		expect(s.fps).toBe(0);
		expect(s.avgPeriod).toBe(0);
	});

	it("derives 60fps from 16.667ms frame periods", () => {
		runFrames(0, 30, 1000 / 60, 4);

		const s = getFrameStats();
		expect(s.fps).toBeCloseTo(60, 6);
		expect(s.minFps).toBeCloseTo(60, 6);
		expect(s.avgPeriod).toBeCloseTo(1000 / 60, 6);
		expect(s.avgWork).toBe(4);
		expect(s.maxWork).toBe(4);
	});

	it("separates the frame period from the work done inside it", () => {
		// 50ms apart but only 3ms of scene work: the renderer is idle-waiting,
		// not the bottleneck.
		runFrames(0, 10, 50, 3);

		const s = getFrameStats();
		expect(s.fps).toBeCloseTo(20, 6);
		expect(s.avgPeriod).toBeCloseTo(50, 6);
		expect(s.avgWork).toBeCloseTo(3, 6);
	});

	it("holds the worst frame in minFps while the average stays high", () => {
		let t = runFrames(0, 20, 10, 1);
		// One 100ms hitch (a bake), then back to smooth frames.
		frameProfilerBegin(t);
		frameProfilerEnd(t + 90);
		t += 100;
		runFrames(t, 20, 10, 1);

		const s = getFrameStats();
		expect(s.maxPeriod).toBeCloseTo(100, 6);
		expect(s.minFps).toBeCloseTo(10, 6);
		expect(s.maxWork).toBeCloseTo(90, 6);
		// 41 samples: 40 at 10ms plus the 100ms hitch, one of which is the
		// unmeasured seed frame.
		expect(s.fps).toBeGreaterThan(45);
		expect(s.sampleCount).toBe(41);
	});

	it("caps the window and forgets samples older than it", () => {
		const t = runFrames(0, 400, 10, 1);
		expect(getFrameStats().sampleCount).toBe(120);

		// A full window of slower frames evicts every fast sample. 121, not
		// 120: the first of them measures the transition and would otherwise
		// leave one 10ms period in the buffer.
		runFrames(t, 121, 20, 1);
		const s = getFrameStats();
		expect(s.sampleCount).toBe(120);
		expect(s.avgPeriod).toBeCloseTo(20, 6);
		expect(s.fps).toBeCloseTo(50, 6);
	});

	it("clears the window on reset", () => {
		runFrames(0, 10, 10, 1);
		frameProfilerReset();

		const s = getFrameStats();
		expect(s.sampleCount).toBe(0);
		expect(s.fps).toBe(0);
		expect(s.maxPeriod).toBe(0);
	});
});
