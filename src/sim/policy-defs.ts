/**
 * Policies — standing government ordinances, and the first thing influence is
 * spent on.
 *
 * A policy costs influence to enact and again every week to sustain, and its
 * effects apply for exactly as long as it is enacted. That recurring cost is
 * the whole design: a policy is a commitment held open against a capped
 * resource, not a one-off purchase.
 *
 * This table is static, cold data. It is read by the modifier bus and by the
 * command processor; nothing here is constructed at runtime.
 *
 * Enacted state lives in `state.policies`, one byte per policy id, indexed by
 * that id. The byte is a *rank*, not a flag: 0 means not enacted, and 1..n give
 * enactment order so insolvency can repeal the newest commitment first.
 *
 * The roster is deliberately three entries. It exists to exercise the plumbing
 * — an additive channel, a multiplicative one, and a policy that pays for
 * itself — not to be a content set.
 */

import { MOD } from "./constants.ts";
import {
	EFFECT_ADD,
	EFFECT_MULT,
	type ModifierEffect,
} from "./modifier-effect.ts";

export interface PolicyDef {
	/** Index of this entry in POLICY_DEFS. */
	readonly id: number;
	readonly name: string;
	readonly description: string;
	readonly influenceCost: number;
	readonly influenceUpkeep: number;
	readonly effects: ReadonlyArray<ModifierEffect>;
}

export const POLICY_UPZONING_MANDATE = 0;
export const POLICY_AUSTERITY_BUDGET = 1;
export const POLICY_CIVIC_OUTREACH = 2;

export const POLICY_DEFS: ReadonlyArray<PolicyDef> = [
	{
		id: POLICY_UPZONING_MANDATE,
		name: "Upzoning Mandate",
		description:
			"Override local objections to denser housing. Residential demand rises; " +
			"the political cost of holding the line does not go away.",
		influenceCost: 60,
		influenceUpkeep: 3,
		effects: [{ channel: MOD.R_DEMAND_ADD, kind: EFFECT_ADD, value: 60 }],
	},
	{
		id: POLICY_AUSTERITY_BUDGET,
		name: "Austerity Budget",
		description:
			"Cut upkeep across the board. Cheaper to run, and residents notice.",
		influenceCost: 40,
		influenceUpkeep: 2,
		effects: [
			{ channel: MOD.MAINTENANCE_MULT, kind: EFFECT_MULT, value: 0.85 },
			{ channel: MOD.R_DEMAND_ADD, kind: EFFECT_ADD, value: -25 },
		],
	},
	{
		id: POLICY_CIVIC_OUTREACH,
		name: "Civic Outreach",
		description:
			"Town halls, ward surgeries, participatory budgeting. Costs influence " +
			"up front and pays it back every week.",
		influenceCost: 50,
		influenceUpkeep: 0,
		effects: [
			{ channel: MOD.INFLUENCE_INCOME_ADD, kind: EFFECT_ADD, value: 3 },
		],
	},
] as const;

export const POLICY_COUNT = POLICY_DEFS.length;

/** The definition for `id`, or undefined if the id is not a policy. */
export function policyDef(id: number): PolicyDef | undefined {
	if (id < 0 || id >= POLICY_COUNT) return undefined;
	return POLICY_DEFS[id];
}
