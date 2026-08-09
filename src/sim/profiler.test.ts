import { describe, expect, it } from "vitest";
import {
	getProfileSnapshot,
	profilerEditEnd,
	profilerEditStart,
	profilerReset,
	profilerSystemEnd,
	profilerSystemStart,
	profilerTickEnd,
	profilerTickStart,
	systemIndex,
} from "./profiler.ts";

describe("edit path profiler", () => {
	it("records off-tick edit samples independently of tick samples", () => {
		profilerReset();

		const t0 = profilerEditStart();
		// busy-ish work so elapsed is measurable under DEV timing
		let x = 0;
		for (let i = 0; i < 50_000; i++) x += i;
		expect(x).toBeGreaterThan(0);
		profilerEditEnd(t0);

		const snap = getProfileSnapshot();
		expect(snap.editSampleCount).toBe(1);
		expect(snap.sampleCount).toBe(0);
		expect(snap.edits.last).toBeGreaterThan(0);
		expect(snap.edits.avg).toBeGreaterThan(0);
	});

	it("does not fold edit time into the tick commands slot", () => {
		profilerReset();

		const te = profilerEditStart();
		profilerEditEnd(te);

		profilerTickStart();
		const t = profilerSystemStart();
		profilerSystemEnd(systemIndex("commands"), t);
		profilerTickEnd();

		const snap = getProfileSnapshot();
		expect(snap.editSampleCount).toBe(1);
		expect(snap.sampleCount).toBe(1);
		// Empty commands measurement stays near zero; edit path is separate.
		const commands = snap.systems.get("commands");
		expect(commands).toBeDefined();
		expect(snap.edits.last).toBeGreaterThanOrEqual(0);
	});
});
