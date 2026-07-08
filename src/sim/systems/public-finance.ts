/**
 * Public finance — tax collection and service costs.
 *
 * Revenue: property tax = sum(landValue * taxRate) for occupied tiles.
 * Expenses: per-capita service cost + road maintenance + rail maintenance
 *           + civic building maintenance.
 *
 * Settles once per in-game week (every DAYS_PER_WEEK ticks). A settlement
 * applies a full week's worth — the per-tick (per-day) rates scaled up by
 * DAYS_PER_WEEK — so the treasury moves at the same pace per tick as if it were
 * charged every tick, just in discrete weekly steps. Non-settlement ticks are a
 * no-op, leaving the last week's breakdown in place for the finances UI.
 *
 * Treasury may go negative (debt) — future systems can add consequences.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BOND_MONTHLY_PAYMENT,
	BUILDING_EMPTY,
	CIVIC_MAINTENANCE,
	CIVIC_NONE,
	DAYS_PER_WEEK,
	INFINITE_TREASURY,
	MAX_BONDS,
	RAIL_MAINTENANCE_COST,
	ROAD_MAINTENANCE_COST,
	SERVICE_COST_PER_POP,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

export function updatePublicFinance(state: CityState): void {
	const { size, zoning, building, roads, rail, civic, landValue, aggregates } =
		state;

	// Finances settle weekly. AGG.TICK is the count of completed ticks, so it is
	// 0 on the very first tick — which settles, populating the breakdown at once.
	if ((aggregates[AGG.TICK] ?? 0) % DAYS_PER_WEEK !== 0) return;

	const taxR = aggregates[AGG.TAX_RATE_R] ?? 0;
	const taxC = aggregates[AGG.TAX_RATE_C] ?? 0;
	const taxI = aggregates[AGG.TAX_RATE_I] ?? 0;
	const totalPop = aggregates[AGG.TOTAL_POP] ?? 0;

	// --- Revenue: property tax on occupied tiles (per-day rate) ---
	let revenue = 0;
	let roadCount = 0;
	let railCount = 0;
	let civicCost = 0;

	for (let i = 0; i < size; i++) {
		const lv = landValue[i] ?? 0;

		if (building[i] !== BUILDING_EMPTY) {
			const zone = zoning[i];
			if (zone === ZONE_RESIDENTIAL) {
				revenue += lv * taxR;
			} else if (zone === ZONE_COMMERCIAL) {
				revenue += lv * taxC;
			} else if (zone === ZONE_INDUSTRIAL) {
				revenue += lv * taxI;
			}
		}

		if (roads[i] === 1) roadCount++;
		if (rail[i] === 1) railCount++;

		const c = civic[i] ?? 0;
		if (c !== CIVIC_NONE) {
			civicCost += CIVIC_MAINTENANCE[c] ?? 0;
		}
	}

	// --- Scale the per-day rates up to a full week's settlement ---
	const revenueWk = revenue * DAYS_PER_WEEK;
	const serviceCostWk = totalPop * SERVICE_COST_PER_POP * DAYS_PER_WEEK;
	const roadCostWk = roadCount * ROAD_MAINTENANCE_COST * DAYS_PER_WEEK;
	const railCostWk = railCount * RAIL_MAINTENANCE_COST * DAYS_PER_WEEK;
	const civicCostWk = civicCost * DAYS_PER_WEEK;

	// --- Bond repayments: each active bond owes up to a week of payments ---
	let bondPaymentWk = 0;
	for (let b = 0; b < MAX_BONDS; b++) {
		const slotIdx = AGG.BOND_SLOT_0 + b;
		const remaining = aggregates[slotIdx] ?? 0;
		if (remaining > 0) {
			const periods = Math.min(DAYS_PER_WEEK, remaining);
			bondPaymentWk += BOND_MONTHLY_PAYMENT * periods;
			aggregates[slotIdx] = remaining - periods;
		}
	}

	const expensesWk =
		serviceCostWk + roadCostWk + railCostWk + civicCostWk + bondPaymentWk;

	// --- Update treasury ---
	// Infinite-money debug cheat pins the treasury so it never depletes.
	if ((aggregates[AGG.DEBUG_INFINITE_MONEY] ?? 0) === 1) {
		aggregates[AGG.TREASURY] = INFINITE_TREASURY;
	} else {
		const treasury = aggregates[AGG.TREASURY] ?? 0;
		aggregates[AGG.TREASURY] = treasury + revenueWk - expensesWk;
	}

	// --- Record this week's breakdown for the finances UI ---
	aggregates[AGG.REVENUE] = revenueWk;
	aggregates[AGG.SERVICE_COST] = serviceCostWk;
	aggregates[AGG.ROAD_COST] = roadCostWk;
	aggregates[AGG.CIVIC_COST] = civicCostWk;
	aggregates[AGG.RAIL_COST] = railCostWk;
	aggregates[AGG.BOND_PAYMENT] = bondPaymentWk;
}
