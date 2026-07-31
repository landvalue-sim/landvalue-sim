import { describe, expect, it } from "vitest";
import { AGG, MOD, SITUATION_PROGRESS_MAX } from "./constants.ts";
import { EFFECT_ADD, EFFECT_MULT } from "./modifier-effect.ts";
import {
	loadSituations,
	SITUATION_TEMPLATE_VERSION,
} from "./situation-loader.ts";
import {
	BOUNDARY_PIN,
	BOUNDARY_RESOLVE,
	TRIGGER_BELOW,
} from "./situation-types.ts";

/**
 * A minimal valid entry. Tests clone it and break one field, so each case
 * proves the loader rejects *that* field rather than something incidental.
 */
function entry(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		key: "test",
		name: "Test",
		description: "A test situation.",
		trigger: {
			aggregate: "TREASURY",
			op: "below",
			value: 0,
			chancePerMonth: 0.5,
		},
		startProgress: 25,
		baseProgressPerMonth: 10,
		atZero: {
			kind: "resolve",
			name: "Over",
			influence: 5,
			treasury: 0,
			opens: null,
		},
		atMax: { kind: "pin" },
		stages: [{ at: 0, name: "Only", effects: [] }],
		approaches: [],
		...overrides,
	};
}

function template(...situations: ReadonlyArray<unknown>): unknown {
	return { version: SITUATION_TEMPLATE_VERSION, situations };
}

describe("loadSituations — accepts", () => {
	it("compiles a minimal template", () => {
		const defs = loadSituations(template(entry()));

		expect(defs.length).toBe(1);
		const def = defs[0];
		expect(def?.id).toBe(1);
		expect(def?.key).toBe("test");
		expect(def?.trigger?.agg).toBe(AGG.TREASURY);
		expect(def?.trigger?.op).toBe(TRIGGER_BELOW);
		expect(def?.atMax.kind).toBe(BOUNDARY_PIN);
		expect(def?.atMax.outcome).toBeNull();
		expect(def?.atZero.kind).toBe(BOUNDARY_RESOLVE);
		expect(def?.atZero.outcome?.influence).toBe(5);
	});

	it("converts percentages to milli-percent", () => {
		const defs = loadSituations(
			template(
				entry({
					startProgress: 25,
					baseProgressPerMonth: -7.5,
					stages: [
						{ at: 0, name: "A", effects: [] },
						{ at: 62.5, name: "B", effects: [] },
					],
				}),
			),
		);

		const per = SITUATION_PROGRESS_MAX / 100;
		expect(defs[0]?.startProgress).toBe(25 * per);
		expect(defs[0]?.baseProgressPerMonth).toBe(-7.5 * per);
		expect(defs[0]?.stages[1]?.threshold).toBe(62.5 * per);
	});

	it("defaults an omitted startProgress rather than failing", () => {
		const raw = entry();
		delete raw["startProgress"];
		expect(loadSituations(template(raw))[0]?.startProgress).toBeGreaterThan(0);
	});

	it("treats a null trigger as 'only opens as an outcome'", () => {
		const defs = loadSituations(
			template(entry({ trigger: null, baseProgressPerMonth: -5 })),
		);
		expect(defs[0]?.trigger).toBeNull();
	});

	it("resolves channel names and effect operators", () => {
		const defs = loadSituations(
			template(
				entry({
					stages: [
						{
							at: 0,
							name: "Only",
							effects: [
								{ channel: "R_DEMAND_ADD", op: "add", value: -20 },
								{ channel: "TAX_REVENUE_MULT", op: "multiply", value: 0.9 },
							],
						},
					],
				}),
			),
		);

		const effects = defs[0]?.stages[0]?.effects ?? [];
		expect(effects[0]).toEqual({
			channel: MOD.R_DEMAND_ADD,
			kind: EFFECT_ADD,
			value: -20,
		});
		expect(effects[1]?.kind).toBe(EFFECT_MULT);
	});

	it("resolves a cross-reference to a situation declared later", () => {
		const defs = loadSituations(
			template(
				entry({
					key: "first",
					atMax: { kind: "resolve", name: "Onward", opens: "second" },
				}),
				entry({ key: "second", trigger: null, baseProgressPerMonth: -5 }),
			),
		);
		expect(defs[0]?.atMax.outcome?.opens).toBe(2);
	});
});

describe("loadSituations — rejects", () => {
	it("a template that is not an object", () => {
		expect(() => loadSituations(null)).toThrow(/expected an object/);
		expect(() => loadSituations([])).toThrow(/expected an object/);
	});

	it("a version it does not understand", () => {
		expect(() =>
			loadSituations({ version: 99, situations: [entry()] }),
		).toThrow(/version/);
	});

	it("an empty roster", () => {
		expect(() => loadSituations(template())).toThrow(/no situations/);
	});

	it("a duplicate key", () => {
		expect(() => loadSituations(template(entry(), entry()))).toThrow(
			/duplicate key/,
		);
	});

	it("an unknown aggregate, and the COUNT sentinel", () => {
		const bad = {
			aggregate: "NOT_REAL",
			op: "below",
			value: 0,
			chancePerMonth: 1,
		};
		expect(() => loadSituations(template(entry({ trigger: bad })))).toThrow(
			/is not an aggregate/,
		);

		const count = {
			aggregate: "COUNT",
			op: "below",
			value: 0,
			chancePerMonth: 1,
		};
		expect(() => loadSituations(template(entry({ trigger: count })))).toThrow(
			/is not an aggregate/,
		);
	});

	it("an unknown modifier channel", () => {
		const stages = [
			{
				at: 0,
				name: "Only",
				effects: [{ channel: "NOPE", op: "add", value: 1 }],
			},
		];
		expect(() => loadSituations(template(entry({ stages })))).toThrow(
			/is not a modifier channel/,
		);
	});

	it("an unknown operator", () => {
		const stages = [
			{
				at: 0,
				name: "Only",
				effects: [{ channel: "R_DEMAND_ADD", op: "sub", value: 1 }],
			},
		];
		expect(() => loadSituations(template(entry({ stages })))).toThrow(
			/expected "add"/,
		);
	});

	it("a chance that could never fire, or could never miss twice", () => {
		const zero = {
			aggregate: "TREASURY",
			op: "below",
			value: 0,
			chancePerMonth: 0,
		};
		expect(() => loadSituations(template(entry({ trigger: zero })))).toThrow(
			/chancePerMonth/,
		);
		const over = {
			aggregate: "TREASURY",
			op: "below",
			value: 0,
			chancePerMonth: 1.5,
		};
		expect(() => loadSituations(template(entry({ trigger: over })))).toThrow(
			/chancePerMonth/,
		);
	});

	it("stages that do not start at zero or do not ascend", () => {
		expect(() =>
			loadSituations(
				template(entry({ stages: [{ at: 10, name: "A", effects: [] }] })),
			),
		).toThrow(/must start at 0/);

		expect(() =>
			loadSituations(
				template(
					entry({
						stages: [
							{ at: 0, name: "A", effects: [] },
							{ at: 0, name: "B", effects: [] },
						],
					}),
				),
			),
		).toThrow(/must ascend/);
	});

	it("a situation with no stages", () => {
		expect(() => loadSituations(template(entry({ stages: [] })))).toThrow(
			/at least one stage/,
		);
	});

	// The check that matters most: an author who writes a zero-drift situation
	// and forgets to give it an approach has created a permanent debuff with no
	// way out, and would not find out until it triggered in play.
	it("a situation that could never end", () => {
		expect(() =>
			loadSituations(
				template(entry({ baseProgressPerMonth: 0, approaches: [] })),
			),
		).toThrow(/could never end/);
	});

	it("a follow-on reference to a key that does not exist", () => {
		const atMax = { kind: "resolve", name: "Onward", opens: "ghost" };
		expect(() => loadSituations(template(entry({ atMax })))).toThrow(
			/no situation with key/,
		);
	});

	it("an unknown boundary kind", () => {
		expect(() =>
			loadSituations(template(entry({ atMax: { kind: "explode" } }))),
		).toThrow(/expected "pin" or "resolve"/);
	});

	it("a negative influence cost", () => {
		const approaches = [
			{
				name: "A",
				description: "d",
				influenceCost: -1,
				influenceUpkeep: 0,
				progressPerMonth: -5,
				effects: [],
			},
		];
		expect(() => loadSituations(template(entry({ approaches })))).toThrow(
			/non-negative/,
		);
	});

	it("a missing or empty name", () => {
		expect(() => loadSituations(template(entry({ name: "" })))).toThrow(
			/non-empty string/,
		);
	});
});
