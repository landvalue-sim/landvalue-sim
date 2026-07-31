import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	DAYS_PER_WEEK,
	INFLUENCE_BASE_PER_WEEK,
	INFLUENCE_CRIME_PENALTY,
	INFLUENCE_CRIME_SATURATION,
	INFLUENCE_EDUCATION_BONUS,
	INFLUENCE_HEALTH_BONUS,
	MAX_INFLUENCE,
	MOD,
	SIT,
} from "../constants.ts";
import {
	POLICY_AUSTERITY_BUDGET,
	POLICY_CIVIC_OUTREACH,
	POLICY_UPZONING_MANDATE,
	policyDef,
} from "../policy-defs.ts";
import { requireSituationId } from "../situation-defs.ts";
import {
	enactPolicy,
	repealPolicy,
	totalInfluenceUpkeep,
	updateInfluence,
	weeklyInfluenceIncome,
} from "./influence.ts";

const HOUSING_CRUNCH = requireSituationId("housing-crunch");

/** A city parked on a settlement boundary, so updateInfluence will run. */
function settlingCity() {
	const city = createCity({ width: 8, height: 8 });
	city.aggregates[AGG.TICK] = DAYS_PER_WEEK * 4;
	return city;
}

describe("weeklyInfluenceIncome", () => {
	it("is the flat base for a city with no services and no crime", () => {
		const city = createCity({ width: 8, height: 8 });
		expect(weeklyInfluenceIncome(city)).toBe(INFLUENCE_BASE_PER_WEEK);
	});

	it("pays out education and health at their full weight", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.EDUCATION_LEVEL] = 100;
		city.aggregates[AGG.HEALTH_LEVEL] = 50;

		expect(weeklyInfluenceIncome(city)).toBeCloseTo(
			INFLUENCE_BASE_PER_WEEK +
				INFLUENCE_EDUCATION_BONUS +
				INFLUENCE_HEALTH_BONUS * 0.5,
			10,
		);
	});

	it("charges crime per head, not in absolute terms", () => {
		const small = createCity({ width: 8, height: 8 });
		small.aggregates[AGG.TOTAL_POP] = 100;
		small.aggregates[AGG.TOTAL_CRIME] = 100 * INFLUENCE_CRIME_SATURATION;

		const large = createCity({ width: 8, height: 8 });
		large.aggregates[AGG.TOTAL_POP] = 10_000;
		large.aggregates[AGG.TOTAL_CRIME] = 10_000 * INFLUENCE_CRIME_SATURATION;

		// Same rate, hundredfold the absolute crime: identical penalty.
		expect(weeklyInfluenceIncome(large)).toBeCloseTo(
			weeklyInfluenceIncome(small),
			10,
		);
		expect(weeklyInfluenceIncome(small)).toBeCloseTo(
			INFLUENCE_BASE_PER_WEEK - INFLUENCE_CRIME_PENALTY,
			10,
		);
	});

	it("never goes negative", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.TOTAL_POP] = 10;
		city.aggregates[AGG.TOTAL_CRIME] = 1_000_000;
		city.modifiers[MOD.INFLUENCE_INCOME_ADD] = -500;

		expect(weeklyInfluenceIncome(city)).toBe(0);
	});

	it("includes the modifier bus contribution", () => {
		const city = createCity({ width: 8, height: 8 });
		city.modifiers[MOD.INFLUENCE_INCOME_ADD] = 3;
		expect(weeklyInfluenceIncome(city)).toBe(INFLUENCE_BASE_PER_WEEK + 3);
	});
});

describe("updateInfluence", () => {
	it("does nothing on a non-settlement tick", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.TICK] = DAYS_PER_WEEK * 4 + 1;
		const before = city.aggregates[AGG.INFLUENCE];

		updateInfluence(city);

		expect(city.aggregates[AGG.INFLUENCE]).toBe(before);
	});

	it("accrues income and pays upkeep", () => {
		const city = settlingCity();
		city.aggregates[AGG.INFLUENCE] = 100;
		expect(enactPolicy(city, POLICY_AUSTERITY_BUDGET)).toBe(true); // 40 up front, 2/wk

		updateInfluence(city);

		// 100 - 40 cost + 5 income - 2 upkeep
		expect(city.aggregates[AGG.INFLUENCE]).toBe(63);
		expect(city.aggregates[AGG.INFLUENCE_INCOME]).toBe(5);
		expect(city.aggregates[AGG.INFLUENCE_UPKEEP]).toBe(2);
	});

	it("holds the stock at the cap", () => {
		const city = settlingCity();
		city.aggregates[AGG.INFLUENCE] = MAX_INFLUENCE;

		updateInfluence(city);

		expect(city.aggregates[AGG.INFLUENCE]).toBe(MAX_INFLUENCE);
	});

	it("repeals the newest policy first when it cannot pay upkeep", () => {
		const city = settlingCity();
		city.aggregates[AGG.INFLUENCE] = 200;
		expect(enactPolicy(city, POLICY_AUSTERITY_BUDGET)).toBe(true); // 2/wk
		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true); // 3/wk
		expect(totalInfluenceUpkeep(city)).toBe(5);

		// Broke, and a week's income (5) is not enough to cover both.
		city.aggregates[AGG.INFLUENCE] = 0;
		city.aggregates[AGG.EDUCATION_LEVEL] = 0;
		updateInfluence(city);

		// Income 5 vs upkeep 5 fits exactly, so nothing is dropped yet.
		expect(city.policies[POLICY_UPZONING_MANDATE]).not.toBe(0);

		// Now make income insufficient and settle again.
		city.modifiers[MOD.INFLUENCE_INCOME_ADD] = -3; // income 2
		city.aggregates[AGG.INFLUENCE] = 0;
		updateInfluence(city);

		// Upzoning was enacted second, so it goes first; austerity (2/wk) fits.
		expect(city.policies[POLICY_UPZONING_MANDATE]).toBe(0);
		expect(city.policies[POLICY_AUSTERITY_BUDGET]).not.toBe(0);
		expect(city.aggregates[AGG.INFLUENCE_UPKEEP]).toBe(2);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(0);
	});

	it("abandons a situation approach only after every policy is gone", () => {
		const city = settlingCity();
		city.aggregates[AGG.INFLUENCE] = 500;
		city.situations[SIT.DEF] = HOUSING_CRUNCH;
		city.situations[SIT.PROGRESS] = 50_000;
		city.situations[SIT.APPROACH] = 1; // Emergency Permitting, 4/wk
		expect(enactPolicy(city, POLICY_AUSTERITY_BUDGET)).toBe(true); // 2/wk

		city.aggregates[AGG.INFLUENCE] = 0;
		city.modifiers[MOD.INFLUENCE_INCOME_ADD] = -5; // income 0
		updateInfluence(city);

		expect(city.policies[POLICY_AUSTERITY_BUDGET]).toBe(0);
		expect(city.situations[SIT.APPROACH]).toBe(0);
		// The situation itself survives; only the response was abandoned.
		expect(city.situations[SIT.DEF]).toBe(HOUSING_CRUNCH);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(0);
	});
});

describe("enactPolicy / repealPolicy", () => {
	it("charges the up-front cost", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.INFLUENCE] = 100;

		expect(enactPolicy(city, POLICY_CIVIC_OUTREACH)).toBe(true);

		const cost = policyDef(POLICY_CIVIC_OUTREACH)?.influenceCost ?? 0;
		expect(city.aggregates[AGG.INFLUENCE]).toBe(100 - cost);
	});

	it("refuses a policy the city cannot afford, changing nothing", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.INFLUENCE] = 10;

		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(false);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(10);
		expect(city.policies[POLICY_UPZONING_MANDATE]).toBe(0);
	});

	it("refuses to enact the same policy twice", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.INFLUENCE] = 500;

		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true);
		const after = city.aggregates[AGG.INFLUENCE];
		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(false);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(after);
	});

	it("refuses an unknown policy id", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.INFLUENCE] = 500;

		expect(enactPolicy(city, 99)).toBe(false);
		expect(enactPolicy(city, -1)).toBe(false);
	});

	it("does not refund on repeal, and drops the upkeep", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.INFLUENCE] = 500;
		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true);
		const after = city.aggregates[AGG.INFLUENCE];

		expect(repealPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true);

		expect(city.aggregates[AGG.INFLUENCE]).toBe(after);
		expect(totalInfluenceUpkeep(city)).toBe(0);
		expect(repealPolicy(city, POLICY_UPZONING_MANDATE)).toBe(false);
	});

	it("keeps enactment ranks dense and ordered", () => {
		const city = createCity({ width: 8, height: 8 });
		city.aggregates[AGG.INFLUENCE] = 500;

		expect(enactPolicy(city, POLICY_CIVIC_OUTREACH)).toBe(true);
		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true);
		expect(enactPolicy(city, POLICY_AUSTERITY_BUDGET)).toBe(true);
		expect(city.policies[POLICY_CIVIC_OUTREACH]).toBe(1);
		expect(city.policies[POLICY_UPZONING_MANDATE]).toBe(2);
		expect(city.policies[POLICY_AUSTERITY_BUDGET]).toBe(3);

		// Removing the middle one closes the gap without reordering the rest.
		expect(repealPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true);
		expect(city.policies[POLICY_CIVIC_OUTREACH]).toBe(1);
		expect(city.policies[POLICY_AUSTERITY_BUDGET]).toBe(2);

		// Re-enacting puts it back at the end, where "newest" belongs.
		expect(enactPolicy(city, POLICY_UPZONING_MANDATE)).toBe(true);
		expect(city.policies[POLICY_UPZONING_MANDATE]).toBe(3);
	});
});
