import { describe, expect, it } from "vitest";
import { createCity } from "./city-state.ts";
import { MAX_GRID_SIZE } from "./constants.ts";
import { getProfileSnapshot, SYSTEM_NAMES } from "./profiler.ts";
import { buildDenseCity } from "./scenarios.ts";
import { tick } from "./tick.ts";

/**
 * Tick-budget benchmark (issue #11) — times a full tick on the worst-case
 * dense city at the maximum map size and reports the per-system breakdown.
 *
 * The interesting output is the logged table, not the assertion: the sim
 * targets the 20 ms Fastest-speed budget (TICK_INTERVALS in sim-worker.ts),
 * but a CI-safe hard assertion has to be far looser than that to survive
 * shared runners. Tightening the budget below is deliberate; a failure here
 * means a system got structurally slower, not that a runner had a bad day.
 */

// Loose CI bound, well above the 20 ms target — see the header comment.
// The dense tick averages ~17 ms after the issue #11 optimisation passes
// (205 ms before them), so this catches a structural regression with room
// for slow shared runners.
const MAX_AVG_TICK_MS = 150;

const WARMUP_TICKS = 2;
const MEASURED_TICKS = 5;

describe("tick budget", () => {
	it("times a full tick on a dense max-size city", () => {
		const city = createCity({
			width: MAX_GRID_SIZE,
			height: MAX_GRID_SIZE,
			seed: 1,
		});
		buildDenseCity(city);

		for (let i = 0; i < WARMUP_TICKS; i++) tick(city, []);
		const t0 = performance.now();
		for (let i = 0; i < MEASURED_TICKS; i++) tick(city, []);
		const avgTick = (performance.now() - t0) / MEASURED_TICKS;

		const snapshot = getProfileSnapshot();
		const rows: string[] = [];
		for (const name of SYSTEM_NAMES) {
			const stats = snapshot.systems.get(name);
			if (stats === undefined) continue;
			rows.push(`${name.padEnd(14)} ${stats.avg.toFixed(2).padStart(8)} ms`);
		}
		rows.push(`${"TOTAL".padEnd(14)} ${avgTick.toFixed(2).padStart(8)} ms`);
		console.log(
			`tick budget @ ${MAX_GRID_SIZE}x${MAX_GRID_SIZE} dense:\n${rows.join("\n")}`,
		);

		expect(avgTick).toBeLessThan(MAX_AVG_TICK_MS);
	});
});
