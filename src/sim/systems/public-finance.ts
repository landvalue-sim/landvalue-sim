/**
 * Public finance — tax collection and service costs.
 *
 * Revenue: property tax = sum(landValue * taxRate) for occupied tiles.
 * Expenses: per-capita service cost + road maintenance + rail maintenance
 *           + civic building maintenance.
 *
 * Treasury increases or decreases each tick by the net balance.
 * Negative treasury is allowed (debt) — future systems can add consequences.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BOND_MONTHLY_PAYMENT,
	BUILDING_EMPTY,
	CIVIC_MAINTENANCE,
	CIVIC_NONE,
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

	const taxR = aggregates[AGG.TAX_RATE_R] ?? 0;
	const taxC = aggregates[AGG.TAX_RATE_C] ?? 0;
	const taxI = aggregates[AGG.TAX_RATE_I] ?? 0;
	const totalPop = aggregates[AGG.TOTAL_POP] ?? 0;

	// --- Revenue: property tax on occupied tiles ---
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

	// --- Bond repayments ---
	let bondPayment = 0;
	for (let b = 0; b < MAX_BONDS; b++) {
		const slotIdx = AGG.BOND_SLOT_0 + b;
		const remaining = aggregates[slotIdx] ?? 0;
		if (remaining > 0) {
			bondPayment += BOND_MONTHLY_PAYMENT;
			aggregates[slotIdx] = remaining - 1;
			if (remaining - 1 <= 0) {
				// Bond matured — remove its payment from total
				aggregates[AGG.BOND_PAYMENT] =
					(aggregates[AGG.BOND_PAYMENT] ?? 0) - BOND_MONTHLY_PAYMENT;
			}
		}
	}

	// --- Expenses ---
	const serviceCost = totalPop * SERVICE_COST_PER_POP;
	const roadCost = roadCount * ROAD_MAINTENANCE_COST;
	const railCost = railCount * RAIL_MAINTENANCE_COST;
	const expenses = serviceCost + roadCost + railCost + civicCost + bondPayment;

	// --- Update treasury ---
	// Infinite-money debug cheat pins the treasury so it never depletes.
	if ((aggregates[AGG.DEBUG_INFINITE_MONEY] ?? 0) === 1) {
		aggregates[AGG.TREASURY] = INFINITE_TREASURY;
	} else {
		const treasury = aggregates[AGG.TREASURY] ?? 0;
		aggregates[AGG.TREASURY] = treasury + revenue - expenses;
	}

	// --- Record this tick's breakdown for the finances UI ---
	aggregates[AGG.REVENUE] = revenue;
	aggregates[AGG.SERVICE_COST] = serviceCost;
	aggregates[AGG.ROAD_COST] = roadCost;
	aggregates[AGG.CIVIC_COST] = civicCost;
	aggregates[AGG.RAIL_COST] = railCost;
	aggregates[AGG.BOND_PAYMENT] = bondPayment;
}
