/**
 * Influence — the city's political capital, and the bookkeeping for the
 * standing commitments it pays for.
 *
 * Money buys concrete; influence buys permission. It settles on the same weekly
 * cadence as public finance and is capped low on purpose: the resource is about
 * choosing between government actions, not accumulating them.
 *
 * Accrual is deliberately O(1). Public finance already pays for a full-grid
 * pass each week and there is no reason to buy a second one, so every term in
 * the income formula is an aggregate some earlier system has already published.
 * The shape of that formula is the design statement: an educated, healthy, safe
 * city grants its government room to act. Neglect the services and you keep the
 * tax base but lose the ability to do anything with it.
 *
 * Policy enact/repeal lives here rather than in the command processor because
 * insolvency repeals too, and the enactment-rank bookkeeping should have one
 * owner. See design_docs/INFLUENCE-AND-BUDGET.md.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	DAYS_PER_WEEK,
	INFLUENCE_BASE_PER_WEEK,
	INFLUENCE_CRIME_PENALTY,
	INFLUENCE_CRIME_SATURATION,
	INFLUENCE_EDUCATION_BONUS,
	INFLUENCE_HEALTH_BONUS,
	MAX_INFLUENCE,
	MAX_SITUATIONS,
	MOD,
	SIT,
} from "../constants.ts";
import { POLICY_COUNT, policyDef } from "../policy-defs.ts";
import { situationDef } from "../situation-defs.ts";
import { SITUATION_NONE } from "../situation-types.ts";

export function updateInfluence(state: CityState): void {
	const agg = state.aggregates;

	// Settles weekly, alongside public finance. AGG.TICK counts completed ticks,
	// so it is 0 on the very first tick — which settles, populating the readout.
	if ((agg[AGG.TICK] ?? 0) % DAYS_PER_WEEK !== 0) return;

	const income = weeklyInfluenceIncome(state);
	agg[AGG.INFLUENCE_INCOME] = income;

	const stock = Math.min(MAX_INFLUENCE, (agg[AGG.INFLUENCE] ?? 0) + income);
	const upkeep = settleUpkeep(state, stock);

	agg[AGG.INFLUENCE_UPKEEP] = upkeep;
	agg[AGG.INFLUENCE] = Math.max(0, Math.min(MAX_INFLUENCE, stock - upkeep));
}

/**
 * This week's gross accrual, before upkeep. Never negative — a city with no
 * schools and rampant crime accrues nothing, but it does not go into political
 * debt.
 */
export function weeklyInfluenceIncome(state: CityState): number {
	const agg = state.aggregates;
	const education = (agg[AGG.EDUCATION_LEVEL] ?? 0) / 100;
	const health = (agg[AGG.HEALTH_LEVEL] ?? 0) / 100;
	const pop = agg[AGG.TOTAL_POP] ?? 0;

	// Crime is normalised per head: a large, well-policed city should not be
	// less governable than a small one with the same crime *rate*.
	const crimePerHead = pop > 0 ? (agg[AGG.TOTAL_CRIME] ?? 0) / pop : 0;
	const crimeShare = Math.min(1, crimePerHead / INFLUENCE_CRIME_SATURATION);

	const income =
		INFLUENCE_BASE_PER_WEEK +
		education * INFLUENCE_EDUCATION_BONUS +
		health * INFLUENCE_HEALTH_BONUS -
		crimeShare * INFLUENCE_CRIME_PENALTY +
		(state.modifiers[MOD.INFLUENCE_INCOME_ADD] ?? 0);

	return Math.max(0, income);
}

/** Weekly influence owed by every standing policy and situation approach. */
export function totalInfluenceUpkeep(state: CityState): number {
	const { policies, situations } = state;
	let upkeep = 0;

	for (let id = 0; id < POLICY_COUNT; id++) {
		if ((policies[id] ?? 0) === 0) continue;
		upkeep += policyDef(id)?.influenceUpkeep ?? 0;
	}

	for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
		const base = slot * SIT.STRIDE;
		const def = situationDef(situations[base + SIT.DEF] ?? SITUATION_NONE);
		if (def === undefined) continue;
		const approachIdx = situations[base + SIT.APPROACH] ?? 0;
		if (approachIdx > 0) {
			upkeep += def.approaches[approachIdx - 1]?.influenceUpkeep ?? 0;
		}
	}

	return upkeep;
}

/**
 * Bring upkeep down to something `stock` can pay for, and return what is owed.
 *
 * Influence never goes negative: a city that cannot pay for its commitments
 * drops them. Policies go first, newest enacted first — the newest thing you
 * promised is the one that gets dropped, which is both the least disruptive
 * reading and the easiest one to explain. Only if repealing every policy is not
 * enough do situation approaches get abandoned, highest slot first; otherwise a
 * player could pick an approach they cannot sustain and keep it for free by
 * simply sitting at zero influence.
 *
 * Nothing dropped this way is refunded.
 */
function settleUpkeep(state: CityState, stock: number): number {
	let upkeep = totalInfluenceUpkeep(state);

	for (let guard = 0; guard < POLICY_COUNT && upkeep > stock; guard++) {
		const id = newestEnactedPolicy(state);
		if (id < 0) break;
		state.policies[id] = 0;
		compactPolicyRanks(state);
		upkeep = totalInfluenceUpkeep(state);
	}

	for (let slot = MAX_SITUATIONS - 1; slot >= 0 && upkeep > stock; slot--) {
		const base = slot * SIT.STRIDE;
		if ((state.situations[base + SIT.APPROACH] ?? 0) === 0) continue;
		state.situations[base + SIT.APPROACH] = 0;
		upkeep = totalInfluenceUpkeep(state);
	}

	return upkeep;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/**
 * Enact `id`, charging its up-front influence cost. Returns false — and changes
 * nothing — if the id is unknown, the policy is already enacted, or the city
 * cannot afford it.
 */
export function enactPolicy(state: CityState, id: number): boolean {
	const def = policyDef(id);
	if (def === undefined) return false;
	if ((state.policies[id] ?? 0) !== 0) return false;

	const agg = state.aggregates;
	const influence = agg[AGG.INFLUENCE] ?? 0;
	if (influence < def.influenceCost) return false;

	agg[AGG.INFLUENCE] = influence - def.influenceCost;
	state.policies[id] = highestPolicyRank(state) + 1;
	compactPolicyRanks(state);
	agg[AGG.INFLUENCE_UPKEEP] = totalInfluenceUpkeep(state);
	return true;
}

/** Repeal `id`. The up-front cost is not refunded. */
export function repealPolicy(state: CityState, id: number): boolean {
	if (policyDef(id) === undefined) return false;
	if ((state.policies[id] ?? 0) === 0) return false;

	state.policies[id] = 0;
	compactPolicyRanks(state);
	state.aggregates[AGG.INFLUENCE_UPKEEP] = totalInfluenceUpkeep(state);
	return true;
}

function highestPolicyRank(state: CityState): number {
	let highest = 0;
	for (let id = 0; id < POLICY_COUNT; id++) {
		const rank = state.policies[id] ?? 0;
		if (rank > highest) highest = rank;
	}
	return highest;
}

/** The enacted policy with the highest rank, or -1 if none are enacted. */
function newestEnactedPolicy(state: CityState): number {
	let newest = -1;
	let highest = 0;
	for (let id = 0; id < POLICY_COUNT; id++) {
		const rank = state.policies[id] ?? 0;
		if (rank > highest) {
			highest = rank;
			newest = id;
		}
	}
	return newest;
}

/**
 * Renumber enacted policies to a dense 1..n, preserving their relative order.
 *
 * Keeping ranks dense is what lets the rank live in a single byte with no
 * overflow path. A monotonic counter would need one, and an overflow path that
 * runs once in sixty-five thousand enactments is a path that is never right.
 * The cost is a bounded double loop over a table that will stay small, run only
 * when the player enacts or repeals something.
 */
function compactPolicyRanks(state: CityState): void {
	const { policies } = state;
	for (let rank = 1; rank <= POLICY_COUNT; rank++) {
		// The lowest rank not yet renumbered. Entries already given 1..rank-1
		// compare below `rank`, and unenacted entries are 0, so both are skipped.
		let nextId = -1;
		let nextRank = 0;
		for (let id = 0; id < POLICY_COUNT; id++) {
			const value = policies[id] ?? 0;
			if (value < rank) continue;
			if (nextId === -1 || value < nextRank) {
				nextId = id;
				nextRank = value;
			}
		}
		if (nextId === -1) return;
		policies[nextId] = rank;
	}
}
