import { describe, expect, it } from "vitest";
import { createCity } from "../city-state.ts";
import { MOD, MOD_BASE, SIT } from "../constants.ts";
import {
	POLICY_AUSTERITY_BUDGET,
	POLICY_COUNT,
	POLICY_DEFS,
	POLICY_UPZONING_MANDATE,
} from "../policy-defs.ts";
import { requireSituationId, situationDef } from "../situation-defs.ts";
import { updateModifiers } from "./modifiers.ts";

const HOUSING_CRUNCH = requireSituationId("housing-crunch");

describe("modifier table", () => {
	it("declares a base for every channel", () => {
		// A channel with no base resets to 0, which for a multiplier means the
		// system reading it silently produces nothing at all.
		expect(MOD_BASE.length).toBe(MOD.COUNT);
	});

	it("gives every policy a valid id and channel", () => {
		expect(POLICY_DEFS.length).toBe(POLICY_COUNT);
		for (let id = 0; id < POLICY_COUNT; id++) {
			const def = POLICY_DEFS[id];
			expect(def?.id).toBe(id);
			for (const effect of def?.effects ?? []) {
				expect(effect.channel).toBeLessThan(MOD.COUNT);
			}
		}
	});
});

describe("updateModifiers", () => {
	it("resets every channel to its declared base", () => {
		const city = createCity({ width: 4, height: 4 });
		city.modifiers.fill(999);

		updateModifiers(city);

		for (let i = 0; i < MOD.COUNT; i++) {
			expect(city.modifiers[i]).toBe(MOD_BASE[i]);
		}
	});

	it("accumulates two policies onto the same channel", () => {
		const city = createCity({ width: 4, height: 4 });
		city.policies[POLICY_UPZONING_MANDATE] = 1; // +60 R demand
		city.policies[POLICY_AUSTERITY_BUDGET] = 2; // -25 R demand, x0.85 upkeep

		updateModifiers(city);

		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(35);
		expect(city.modifiers[MOD.MAINTENANCE_MULT]).toBeCloseTo(0.85, 10);
	});

	it("leaves nothing behind when a policy is repealed", () => {
		const city = createCity({ width: 4, height: 4 });
		city.policies[POLICY_UPZONING_MANDATE] = 1;
		updateModifiers(city);
		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(60);

		city.policies[POLICY_UPZONING_MANDATE] = 0;
		updateModifiers(city);

		// Rebuilt from scratch, so a withdrawn contribution cannot linger.
		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(0);
	});

	it("applies the live stage of an open situation, not its earlier ones", () => {
		const city = createCity({ width: 4, height: 4 });
		const def = situationDef(HOUSING_CRUNCH);
		expect(def).toBeDefined();

		city.situations[SIT.DEF] = HOUSING_CRUNCH;
		city.situations[SIT.STAGE] = 2; // Housing Emergency

		updateModifiers(city);

		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(-140);
		expect(city.modifiers[MOD.TAX_REVENUE_MULT]).toBeCloseTo(0.95, 10);
	});

	it("adds the chosen approach's effects on top of the stage", () => {
		const city = createCity({ width: 4, height: 4 });
		city.situations[SIT.DEF] = HOUSING_CRUNCH;
		city.situations[SIT.STAGE] = 0; // Rising Rents, -20
		city.situations[SIT.APPROACH] = 1; // Emergency Permitting, +40

		updateModifiers(city);

		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(20);
	});

	it("ignores an approach index of zero", () => {
		const city = createCity({ width: 4, height: 4 });
		city.situations[SIT.DEF] = HOUSING_CRUNCH;
		city.situations[SIT.STAGE] = 0;
		city.situations[SIT.APPROACH] = 0;

		updateModifiers(city);

		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(-20);
	});
});
