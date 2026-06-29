/**
 * React hooks bridging the UI to the three data sources: the interaction store
 * (tool/overlay/speed), the live city aggregates in the SharedArrayBuffer, and
 * the dev-only profiler/violation snapshots posted by the worker.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SimClient, SimStats } from "../app/sim-client.ts";
import type { InteractionSnapshot, InteractionStore } from "../app/store.ts";
import { AGG, type CityState, START_YEAR } from "../sim/index.ts";

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
	readonly serviceCost: number;
	readonly roadCost: number;
	readonly civicCost: number;
	readonly railCost: number;
	readonly taxR: number;
	readonly taxC: number;
	readonly taxI: number;
	readonly powerCapacity: number;
	readonly powerDemand: number;
	readonly waterCapacity: number;
	readonly waterDemand: number;
	readonly month: number;
	readonly year: number;
}

function readStats(city: CityState): LiveStats {
	const a = city.aggregates;
	const tick = a[AGG.TICK] ?? 0;
	return {
		pop: a[AGG.TOTAL_POP] ?? 0,
		jobs: (a[AGG.TOTAL_C_JOBS] ?? 0) + (a[AGG.TOTAL_I_JOBS] ?? 0),
		treasury: a[AGG.TREASURY] ?? 0,
		tick,
		rDemand: a[AGG.R_DEMAND] ?? 0,
		cDemand: a[AGG.C_DEMAND] ?? 0,
		iDemand: a[AGG.I_DEMAND] ?? 0,
		revenue: a[AGG.REVENUE] ?? 0,
		serviceCost: a[AGG.SERVICE_COST] ?? 0,
		roadCost: a[AGG.ROAD_COST] ?? 0,
		civicCost: a[AGG.CIVIC_COST] ?? 0,
		railCost: a[AGG.RAIL_COST] ?? 0,
		taxR: a[AGG.TAX_RATE_R] ?? 0,
		taxC: a[AGG.TAX_RATE_C] ?? 0,
		taxI: a[AGG.TAX_RATE_I] ?? 0,
		powerCapacity: a[AGG.POWER_CAPACITY] ?? 0,
		powerDemand: a[AGG.POWER_DEMAND] ?? 0,
		waterCapacity: a[AGG.WATER_CAPACITY] ?? 0,
		waterDemand: a[AGG.WATER_DEMAND] ?? 0,
		month: (Math.floor(tick) % 12) + 1,
		year: START_YEAR + Math.floor(Math.floor(tick) / 12),
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

/** Subscribe to dev profiler/violation snapshots from the worker. */
export function useSimStats(sim: SimClient): SimStats | null {
	const [stats, setStats] = useState<SimStats | null>(null);
	useEffect(() => sim.onStats(setStats), [sim]);
	return stats;
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

export function formatDate(month: number, year: number): string {
	return `${MONTH_NAMES[month - 1] ?? "???"} ${year}`;
}
