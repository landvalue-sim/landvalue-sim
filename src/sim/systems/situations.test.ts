import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import {
	AGG,
	DAYS_PER_MONTH,
	MAX_SITUATIONS,
	SIT,
	SITUATION_PROGRESS_MAX,
} from "../constants.ts";
import {
	requireSituationId,
	SITUATION_DEF_COUNT,
	SITUATION_DEFS,
	situationDef,
	situationIdByKey,
} from "../situation-defs.ts";
import { BOUNDARY_RESOLVE, SITUATION_NONE } from "../situation-types.ts";
import {
	countOpenSituations,
	createSituationSlotView,
	isSituationOpen,
	openSituation,
	readSituationSlot,
	setSituationApproach,
	updateSituations,
} from "./situations.ts";

const HOUSING_CRUNCH = requireSituationId("housing-crunch");
const HOUSING_COLLAPSE = requireSituationId("housing-collapse");
const FISCAL_EMERGENCY = requireSituationId("fiscal-emergency");
const CONSTRUCTION_BOOM = requireSituationId("construction-boom");

const PCT = SITUATION_PROGRESS_MAX / 100;

/** A city parked on a month boundary, so updateSituations will run. */
function monthlyCity(month = 6) {
	const city = createCity({ width: 8, height: 8 });
	city.aggregates[AGG.TICK] = DAYS_PER_MONTH * month;
	city.aggregates[AGG.INFLUENCE] = 500;
	return city;
}

/** Step the city to the next month boundary and run the pass. */
function nextMonth(city: ReturnType<typeof monthlyCity>): void {
	city.aggregates[AGG.TICK] = (city.aggregates[AGG.TICK] ?? 0) + DAYS_PER_MONTH;
	updateSituations(city);
}

describe("situation template", () => {
	it("compiles every entry with a dense 1-based id", () => {
		expect(SITUATION_DEF_COUNT).toBeGreaterThan(0);
		for (let i = 0; i < SITUATION_DEF_COUNT; i++) {
			expect(SITUATION_DEFS[i]?.id).toBe(i + 1);
		}
		expect(situationDef(SITUATION_NONE)).toBeUndefined();
		expect(situationDef(SITUATION_DEF_COUNT + 1)).toBeUndefined();
	});

	it("resolves keys, and reports the unknown ones", () => {
		expect(situationIdByKey("housing-crunch")).toBe(HOUSING_CRUNCH);
		expect(situationIdByKey("no-such-situation")).toBe(0);
		expect(() => requireSituationId("no-such-situation")).toThrow();
	});

	it("converts template percentages into milli-percent", () => {
		const def = situationDef(HOUSING_CRUNCH);
		// 12%/month in the JSON.
		expect(def?.baseProgressPerMonth).toBe(12 * PCT);
		expect(def?.startProgress).toBe(20 * PCT);
		expect(def?.stages[1]?.threshold).toBe(30 * PCT);
		// -30%/month in the JSON.
		expect(def?.approaches[0]?.progressPerMonth).toBe(-30 * PCT);
	});

	it("gives every situation a way to move", () => {
		// A situation that cannot move is an eternal modifier with no handle on
		// it. The loader rejects one, so the shipped roster must satisfy it.
		for (const def of SITUATION_DEFS) {
			const movable =
				def.baseProgressPerMonth !== 0 ||
				def.approaches.some((a) => a.progressPerMonth !== 0);
			expect(movable).toBe(true);
		}
	});

	it("starts every stage list at zero and climbs", () => {
		for (const def of SITUATION_DEFS) {
			expect(def.stages.length).toBeGreaterThan(0);
			expect(def.stages[0]?.threshold).toBe(0);
			for (let i = 1; i < def.stages.length; i++) {
				expect(def.stages[i]?.threshold).toBeGreaterThan(
					def.stages[i - 1]?.threshold ?? 0,
				);
			}
		}
	});

	it("pairs a resolving boundary with an outcome and a pinned one without", () => {
		for (const def of SITUATION_DEFS) {
			for (const boundary of [def.atZero, def.atMax]) {
				if (boundary.kind === BOUNDARY_RESOLVE) {
					expect(boundary.outcome).not.toBeNull();
				} else {
					expect(boundary.outcome).toBeNull();
				}
			}
		}
	});

	it("only resolves a follow-on reference to a situation that exists", () => {
		for (const def of SITUATION_DEFS) {
			for (const boundary of [def.atZero, def.atMax]) {
				const opens = boundary.outcome?.opens ?? 0;
				if (opens !== 0) expect(situationDef(opens)).toBeDefined();
			}
		}
	});
});

describe("openSituation", () => {
	it("fills the first free slot at the template's start progress", () => {
		const city = monthlyCity();

		expect(openSituation(city, HOUSING_CRUNCH)).toBe(0);
		expect(city.situations[SIT.DEF]).toBe(HOUSING_CRUNCH);
		expect(city.situations[SIT.PROGRESS]).toBe(20 * PCT);
		expect(city.situations[SIT.STAGE]).toBe(0);
		expect(isSituationOpen(city, HOUSING_CRUNCH)).toBe(true);
	});

	it("stages a situation that opens partway up the bar", () => {
		const city = monthlyCity();
		// The boom starts at 100%, which is its third stage, not its first.
		expect(openSituation(city, CONSTRUCTION_BOOM)).toBe(0);
		expect(city.situations[SIT.PROGRESS]).toBe(SITUATION_PROGRESS_MAX);
		expect(city.situations[SIT.STAGE]).toBe(2);
	});

	it("refuses a ninth situation rather than evicting one", () => {
		const city = monthlyCity();
		for (let i = 0; i < MAX_SITUATIONS; i++) {
			expect(openSituation(city, HOUSING_CRUNCH)).toBe(i);
		}
		expect(openSituation(city, FISCAL_EMERGENCY)).toBe(-1);
		expect(countOpenSituations(city)).toBe(MAX_SITUATIONS);
	});

	it("refuses an unknown definition", () => {
		const city = monthlyCity();
		expect(openSituation(city, SITUATION_NONE)).toBe(-1);
		expect(openSituation(city, 999)).toBe(-1);
	});
});

describe("updateSituations — drift", () => {
	it("does nothing between month boundaries", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.aggregates[AGG.TICK] = DAYS_PER_MONTH * 6 + 1;

		updateSituations(city);

		expect(city.situations[SIT.PROGRESS]).toBe(20 * PCT);
	});

	it("climbs when the drift is positive", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);

		nextMonth(city);

		expect(city.situations[SIT.PROGRESS]).toBe(32 * PCT);
		expect(city.situations[SIT.LAST_DELTA]).toBe(12 * PCT);
	});

	it("falls when the drift is negative", () => {
		const city = monthlyCity();
		void openSituation(city, CONSTRUCTION_BOOM);

		nextMonth(city);

		// A good spell fades on its own: 100% - 10%/mo.
		expect(city.situations[SIT.PROGRESS]).toBe(90 * PCT);
		expect(city.situations[SIT.LAST_DELTA]).toBe(-10 * PCT);
	});

	it("stays put when the drift is zero and no approach is chosen", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_COLLAPSE);

		nextMonth(city);
		nextMonth(city);

		// The aftermath does not heal by itself. That is the point of it.
		expect(city.situations[SIT.PROGRESS]).toBe(SITUATION_PROGRESS_MAX);
		expect(city.situations[SIT.DEF]).toBe(HOUSING_COLLAPSE);
	});

	it("nets an approach against the drift", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		expect(setSituationApproach(city, 0, 1)).toBe(true); // -30%/mo

		nextMonth(city);

		// 20% + 12% base - 30% approach = 2%
		expect(city.situations[SIT.PROGRESS]).toBe(2 * PCT);
		expect(city.situations[SIT.LAST_DELTA]).toBe(-18 * PCT);
	});

	it("lets an approach push a good situation back up", () => {
		const city = monthlyCity();
		void openSituation(city, CONSTRUCTION_BOOM);
		city.situations[SIT.PROGRESS] = 50 * PCT;
		expect(setSituationApproach(city, 0, 1)).toBe(true); // +6%/mo

		nextMonth(city);

		// -10% drift + 6% approach: the boom still fades, just slower.
		expect(city.situations[SIT.PROGRESS]).toBe(46 * PCT);
	});

	it("picks the highest stage the progress has reached", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.situations[SIT.PROGRESS] = 57 * PCT; // one month below the 70% stage

		nextMonth(city);
		expect(city.situations[SIT.PROGRESS]).toBe(69 * PCT);
		expect(city.situations[SIT.STAGE]).toBe(1);

		nextMonth(city);
		expect(city.situations[SIT.STAGE]).toBe(2);
	});
});

describe("updateSituations — boundaries", () => {
	it("resolves at zero, freeing the slot and paying the outcome", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		expect(setSituationApproach(city, 0, 1)).toBe(true);
		city.situations[SIT.PROGRESS] = 5 * PCT;
		const influence = city.aggregates[AGG.INFLUENCE] ?? 0;

		nextMonth(city);

		expect(city.situations[SIT.DEF]).toBe(SITUATION_NONE);
		expect(city.aggregates[AGG.SITUATION_COUNT]).toBe(0);
		// "Shortage Eased" pays 15 influence back.
		expect(city.aggregates[AGG.INFLUENCE]).toBe(influence + 15);
		// And the abandoned approach stops billing.
		expect(city.aggregates[AGG.INFLUENCE_UPKEEP]).toBe(0);
	});

	it("resolves at the ceiling with a different outcome, and chains", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.situations[SIT.PROGRESS] = 95 * PCT;
		city.aggregates[AGG.INFLUENCE] = 100;
		const treasury = city.aggregates[AGG.TREASURY] ?? 0;

		nextMonth(city);

		// The crunch is gone, but not because it was fixed.
		expect(isSituationOpen(city, HOUSING_CRUNCH)).toBe(false);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(90); // -10
		expect(city.aggregates[AGG.TREASURY]).toBe(treasury - 2500);
		// "Housing Collapse" takes its place.
		expect(isSituationOpen(city, HOUSING_COLLAPSE)).toBe(true);
		expect(city.aggregates[AGG.SITUATION_COUNT]).toBe(1);
	});

	it("gives a chained situation no free drift on the month it opens", () => {
		const city = monthlyCity();
		// Slot 0 will resolve; the follow-on must not land in slot 1 and then be
		// advanced by the same pass that created it.
		void openSituation(city, HOUSING_CRUNCH);
		city.situations[SIT.PROGRESS] = 95 * PCT;

		nextMonth(city);

		const collapse = situationDef(HOUSING_COLLAPSE);
		expect(city.situations[SIT.PROGRESS]).toBe(collapse?.startProgress);
		expect(city.situations[SIT.LAST_DELTA]).toBe(0);
	});

	it("pins at the ceiling when that end does not resolve", () => {
		const city = monthlyCity();
		void openSituation(city, FISCAL_EMERGENCY);
		city.situations[SIT.PROGRESS] = SITUATION_PROGRESS_MAX - 1 * PCT;

		nextMonth(city);
		expect(city.situations[SIT.PROGRESS]).toBe(SITUATION_PROGRESS_MAX);

		nextMonth(city);
		expect(city.situations[SIT.PROGRESS]).toBe(SITUATION_PROGRESS_MAX);
		expect(city.situations[SIT.DEF]).toBe(FISCAL_EMERGENCY);
		expect(city.situations[SIT.LAST_DELTA]).toBe(0);
	});

	it("clamps an outcome's influence payout to the stock's range", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.situations[SIT.PROGRESS] = 95 * PCT;
		city.aggregates[AGG.INFLUENCE] = 3; // less than the 10 the collapse costs

		nextMonth(city);

		expect(city.aggregates[AGG.INFLUENCE]).toBe(0);
	});
});

describe("updateSituations — triggers", () => {
	it("opens a situation when its aggregate crosses and the roll lands", () => {
		const city = monthlyCity();
		// Housing Crunch watches R_DEMAND >= 700 with a 30% monthly chance.
		city.aggregates[AGG.R_DEMAND] = 900;

		for (let i = 0; i < 12; i++) nextMonth(city);

		expect(isSituationOpen(city, HOUSING_CRUNCH)).toBe(true);
	});

	it("never triggers while every aggregate is on the safe side", () => {
		const city = monthlyCity();
		city.aggregates[AGG.R_DEMAND] = 699;
		city.aggregates[AGG.TREASURY] = 1;
		city.aggregates[AGG.TOTAL_POP] = 1999;

		for (let i = 0; i < 50; i++) nextMonth(city);

		expect(countOpenSituations(city)).toBe(0);
	});

	it("never triggers a situation that has no trigger", () => {
		const city = monthlyCity();
		// Everything that could fire, fires — the collapse still cannot, because
		// it only ever arrives as the crunch's outcome.
		city.aggregates[AGG.TREASURY] = -1;
		city.aggregates[AGG.TOTAL_POP] = 5000;

		for (let i = 0; i < 30; i++) nextMonth(city);

		expect(isSituationOpen(city, HOUSING_COLLAPSE)).toBe(false);
	});

	it("does not open a second copy of a situation already running", () => {
		const city = monthlyCity();
		city.aggregates[AGG.TREASURY] = -1; // Fiscal Emergency, 50%/mo

		for (let i = 0; i < 34; i++) nextMonth(city);

		let copies = 0;
		for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
			if (city.situations[slot * SIT.STRIDE + SIT.DEF] === FISCAL_EMERGENCY) {
				copies++;
			}
		}
		expect(copies).toBe(1);
	});

	it("is deterministic for a given seed", () => {
		const runs = [0, 1].map(() => {
			const city = createCity({ width: 8, height: 8, seed: 1234 });
			city.aggregates[AGG.R_DEMAND] = 900;
			city.aggregates[AGG.TOTAL_POP] = 5000;
			for (let month = 1; month < 24; month++) {
				city.aggregates[AGG.TICK] = DAYS_PER_MONTH * month;
				updateSituations(city);
			}
			return Array.from(city.situations);
		});
		expect(runs[0]).toEqual(runs[1]);
	});
});

describe("setSituationApproach", () => {
	it("charges the approach's up-front cost", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.aggregates[AGG.INFLUENCE] = 100;

		expect(setSituationApproach(city, 0, 1)).toBe(true); // costs 80

		expect(city.aggregates[AGG.INFLUENCE]).toBe(20);
		expect(city.aggregates[AGG.INFLUENCE_UPKEEP]).toBe(4);
	});

	it("refuses one the city cannot afford, changing nothing", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.aggregates[AGG.INFLUENCE] = 10;

		expect(setSituationApproach(city, 0, 1)).toBe(false);
		expect(city.situations[SIT.APPROACH]).toBe(0);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(10);
	});

	it("charges the new approach in full when switching, with no refund", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		city.aggregates[AGG.INFLUENCE] = 200;

		expect(setSituationApproach(city, 0, 2)).toBe(true); // 30
		expect(setSituationApproach(city, 0, 1)).toBe(true); // 80

		expect(city.aggregates[AGG.INFLUENCE]).toBe(90);
		expect(city.situations[SIT.APPROACH]).toBe(1);
	});

	it("abandons for free and clears the upkeep", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);
		expect(setSituationApproach(city, 0, 1)).toBe(true);
		const after = city.aggregates[AGG.INFLUENCE];

		expect(setSituationApproach(city, 0, 0)).toBe(true);

		expect(city.situations[SIT.APPROACH]).toBe(0);
		expect(city.aggregates[AGG.INFLUENCE]).toBe(after);
		expect(city.aggregates[AGG.INFLUENCE_UPKEEP]).toBe(0);
	});

	it("refuses an empty slot, an out-of-range slot, and an unknown approach", () => {
		const city = monthlyCity();
		void openSituation(city, HOUSING_CRUNCH);

		expect(setSituationApproach(city, 1, 1)).toBe(false); // empty slot
		expect(setSituationApproach(city, -1, 1)).toBe(false);
		expect(setSituationApproach(city, MAX_SITUATIONS, 1)).toBe(false);
		expect(setSituationApproach(city, 0, 9)).toBe(false);
		expect(city.situations[SIT.APPROACH]).toBe(0);
	});
});

describe("readSituationSlot", () => {
	it("copies a slot into the caller's struct", () => {
		const city = monthlyCity();
		void openSituation(city, FISCAL_EMERGENCY);
		const view = createSituationSlotView();

		readSituationSlot(city, 0, view);

		expect(view.defId).toBe(FISCAL_EMERGENCY);
		expect(view.progress).toBe(20 * PCT);
		expect(view.startTick).toBe(DAYS_PER_MONTH * 6);
	});

	it("reports an out-of-range slot as empty", () => {
		const city = monthlyCity();
		const view = createSituationSlotView();
		view.defId = HOUSING_CRUNCH;

		readSituationSlot(city, MAX_SITUATIONS, view);

		expect(view.defId).toBe(SITUATION_NONE);
	});
});
