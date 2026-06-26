/**
 * Public finance — tax collection and service costs.
 *
 * Revenue: property tax = sum(landValue * taxRate) for occupied tiles.
 * Expenses: per-capita service cost + road maintenance.
 *
 * Treasury increases or decreases each tick by the net balance.
 * Negative treasury is allowed (debt) — future systems can add consequences.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	BUILDING_EMPTY,
	ROAD_MAINTENANCE_COST,
	SERVICE_COST_PER_POP,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

export function updatePublicFinance(state: CityState): void {
	const { size, zoning, building, roads, landValue, aggregates } = state;

	const taxR = aggregates[AGG.TAX_RATE_R] ?? 0;
	const taxC = aggregates[AGG.TAX_RATE_C] ?? 0;
	const taxI = aggregates[AGG.TAX_RATE_I] ?? 0;
	const totalPop = aggregates[AGG.TOTAL_POP] ?? 0;

	// --- Revenue: property tax on occupied tiles ---
	let revenue = 0;
	let roadCount = 0;

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

		if (roads[i] === 1) {
			roadCount++;
		}
	}

	// --- Expenses ---
	const serviceCost = totalPop * SERVICE_COST_PER_POP;
	const roadCost = roadCount * ROAD_MAINTENANCE_COST;
	const expenses = serviceCost + roadCost;

	// --- Update treasury ---
	const treasury = aggregates[AGG.TREASURY] ?? 0;
	aggregates[AGG.TREASURY] = treasury + revenue - expenses;
}
