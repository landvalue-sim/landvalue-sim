/**
 * React hooks bridging the UI to the three data sources: the interaction store
 * (tool/overlay/speed), the live city aggregates in the SharedArrayBuffer, and
 * the dev-only profiler/violation snapshots posted by the worker.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SimClient, SimStats } from "../app/sim-client.ts";
import type { InteractionSnapshot, InteractionStore } from "../app/store.ts";
import { type FrameStats, getFrameStats } from "../render/frame-profiler.ts";
import {
	AGG,
	type CityState,
	createSituationSlotView,
	DAYS_PER_MONTH,
	DAYS_PER_YEAR,
	MAX_SITUATIONS,
	readSituationSlot,
	SITUATION_NONE,
	START_YEAR,
} from "../sim/index.ts";

export function useInteraction(store: InteractionStore): InteractionSnapshot {
	return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export interface LiveStats {
	readonly pop: number;
	readonly jobs: number;
	readonly treasury: number;
	readonly tick: number;
	readonly rDemand: number;
	readonly cDemand: number;
	readonly iDemand: number;
	readonly revenue: number;
	readonly roadCost: number;
	readonly civicCost: number;
	readonly railCost: number;
	readonly pipeCost: number;
	readonly taxR: number;
	readonly taxC: number;
	readonly taxI: number;
	readonly powerCapacity: number;
	readonly powerDemand: number;
	readonly powerServed: number;
	readonly waterCapacity: number;
	readonly waterDemand: number;
	readonly waterServed: number;
	readonly bondPayment: number;
	readonly totalCrime: number;
	readonly fireCount: number;
	readonly connectionCount: number;
	readonly trafficCongestion: number;
	readonly educationLevel: number;
	readonly healthLevel: number;
	readonly influence: number;
	readonly influenceIncome: number;
	readonly influenceUpkeep: number;
	readonly situationCount: number;
	readonly day: number;
	readonly month: number;
	readonly year: number;
}

function readStats(city: CityState): LiveStats {
	const a = city.aggregates;
	const tick = a[AGG.TICK] ?? 0;
	const days = Math.floor(tick);
	return {
		pop: a[AGG.TOTAL_POP] ?? 0,
		jobs: (a[AGG.TOTAL_C_JOBS] ?? 0) + (a[AGG.TOTAL_I_JOBS] ?? 0),
		treasury: a[AGG.TREASURY] ?? 0,
		tick,
		rDemand: a[AGG.R_DEMAND] ?? 0,
		cDemand: a[AGG.C_DEMAND] ?? 0,
		iDemand: a[AGG.I_DEMAND] ?? 0,
		revenue: a[AGG.REVENUE] ?? 0,
		roadCost: a[AGG.ROAD_COST] ?? 0,
		civicCost: a[AGG.CIVIC_COST] ?? 0,
		railCost: a[AGG.RAIL_COST] ?? 0,
		pipeCost: a[AGG.PIPE_COST] ?? 0,
		taxR: a[AGG.TAX_RATE_R] ?? 0,
		taxC: a[AGG.TAX_RATE_C] ?? 0,
		taxI: a[AGG.TAX_RATE_I] ?? 0,
		powerCapacity: a[AGG.POWER_CAPACITY] ?? 0,
		powerDemand: a[AGG.POWER_DEMAND] ?? 0,
		powerServed: a[AGG.POWER_SERVED] ?? 0,
		waterCapacity: a[AGG.WATER_CAPACITY] ?? 0,
		waterDemand: a[AGG.WATER_DEMAND] ?? 0,
		waterServed: a[AGG.WATER_SERVED] ?? 0,
		bondPayment: a[AGG.BOND_PAYMENT] ?? 0,
		totalCrime: a[AGG.TOTAL_CRIME] ?? 0,
		fireCount: a[AGG.FIRE_COUNT] ?? 0,
		connectionCount: a[AGG.CONNECTION_COUNT] ?? 0,
		trafficCongestion: a[AGG.TRAFFIC_CONGESTION] ?? 0,
		educationLevel: a[AGG.EDUCATION_LEVEL] ?? 0,
		healthLevel: a[AGG.HEALTH_LEVEL] ?? 0,
		influence: a[AGG.INFLUENCE] ?? 0,
		influenceIncome: a[AGG.INFLUENCE_INCOME] ?? 0,
		influenceUpkeep: a[AGG.INFLUENCE_UPKEEP] ?? 0,
		situationCount: a[AGG.SITUATION_COUNT] ?? 0,
		// One tick = one day, on a fixed 30-day / 360-day calendar.
		day: (days % DAYS_PER_MONTH) + 1,
		month: (Math.floor(days / DAYS_PER_MONTH) % 12) + 1,
		year: START_YEAR + Math.floor(days / DAYS_PER_YEAR),
	};
}

const STATS_REFRESH_MS = 150;

/** Poll the shared city aggregates on a throttled rAF loop for display. */
export function useLiveStats(city: CityState): LiveStats {
	const [stats, setStats] = useState<LiveStats>(() => readStats(city));
	const lastRef = useRef(0);

	useEffect(() => {
		let raf = 0;
		const loop = (t: number): void => {
			if (t - lastRef.current >= STATS_REFRESH_MS) {
				lastRef.current = t;
				setStats(readStats(city));
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [city]);

	return stats;
}

/** One open situation, flattened for rendering. */
export interface LiveSituation {
	readonly slot: number;
	readonly defId: number;
	readonly progress: number;
	readonly stage: number;
	readonly approach: number;
	readonly lastDelta: number;
}

const SITUATIONS_REFRESH_MS = 250;

/**
 * Poll the situation pool for the open slots.
 *
 * Unlike the aggregates this is a list, so a fresh array every poll would
 * re-render the whole panel seven times a second for state that changes once a
 * month. The poll therefore builds a signature first and only publishes a new
 * array when something actually moved.
 */
export function useSituations(city: CityState): ReadonlyArray<LiveSituation> {
	const [open, setOpen] = useState<ReadonlyArray<LiveSituation>>([]);
	const signatureRef = useRef("");

	useEffect(() => {
		let raf = 0;
		let last = 0;
		const view = createSituationSlotView();

		const loop = (t: number): void => {
			if (t - last >= SITUATIONS_REFRESH_MS) {
				last = t;
				const next: LiveSituation[] = [];
				let signature = "";
				for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
					readSituationSlot(city, slot, view);
					if (view.defId === SITUATION_NONE) continue;
					next.push({
						slot,
						defId: view.defId,
						progress: view.progress,
						stage: view.stage,
						approach: view.approach,
						lastDelta: view.lastDelta,
					});
					signature += `${slot}:${view.defId}:${view.progress}:${view.stage}:${view.approach}|`;
				}
				if (signature !== signatureRef.current) {
					signatureRef.current = signature;
					setOpen(next);
				}
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [city]);

	return open;
}

const RENDER_STATS_REFRESH_MS = 250;

/**
 * Poll the render loop's frame timings. Separate from `useSimStats` because
 * the renderer runs on this thread — there is no message to subscribe to, just
 * a module-level window the scene fills in as it draws. When `enabled` is
 * false the poll loop is not installed at all, so a hidden readout costs
 * nothing (and, more to the point, stops re-rendering the panel four times a
 * second while you are trying to profile something else).
 */
export function useRenderStats(enabled: boolean): FrameStats {
	const [stats, setStats] = useState<FrameStats>(getFrameStats);
	const lastRef = useRef(0);

	useEffect(() => {
		if (!enabled) return;
		let raf = 0;
		const loop = (t: number): void => {
			if (t - lastRef.current >= RENDER_STATS_REFRESH_MS) {
				lastRef.current = t;
				setStats(getFrameStats());
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [enabled]);

	return stats;
}

/** Subscribe to dev profiler/violation snapshots from the worker. */
export function useSimStats(sim: SimClient): SimStats | null {
	const [stats, setStats] = useState<SimStats | null>(null);
	useEffect(() => sim.onStats(setStats), [sim]);
	return stats;
}

/**
 * How many edits are currently undoable. The worker owns the undo history, so
 * this arrives by message rather than being read from the shared buffer.
 */
export function useUndoDepth(sim: SimClient): number {
	const [depth, setDepth] = useState(0);
	useEffect(() => sim.onUndoDepth(setDepth), [sim]);
	return depth;
}

const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

export function formatDate(day: number, month: number, year: number): string {
	return `${MONTH_NAMES[month - 1] ?? "???"} ${day}, ${year}`;
}
