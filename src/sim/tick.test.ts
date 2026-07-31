import { describe, expect, it } from "vitest";
import { createCity } from "./city-state.ts";
import type { Command } from "./commands.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_COAL_PLANT,
	DAYS_PER_WEEK,
	INFLUENCE_BASE_PER_WEEK,
	MOD,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
import {
	POLICY_AUSTERITY_BUDGET,
	POLICY_UPZONING_MANDATE,
} from "./policy-defs.ts";
import { applyEdits, tick } from "./tick.ts";

function smallCity() {
	return createCity({ width: 16, height: 16, seed: 42 });
}

describe("tick", () => {
	it("increments the tick counter", () => {
		const city = smallCity();
		expect(city.aggregates[AGG.TICK]).toBe(0);

		tick(city, []);
		expect(city.aggregates[AGG.TICK]).toBe(1);

		tick(city, []);
		expect(city.aggregates[AGG.TICK]).toBe(2);
	});

	it("processes zone commands and updates demand", () => {
		const city = smallCity();

		// Build some roads and zone I
		const commands: Command[] = [
			{ kind: "build-road", x: 5, y: 5 },
			{ kind: "zone", x: 4, y: 5, zoneType: ZONE_INDUSTRIAL },
			{ kind: "zone", x: 6, y: 5, zoneType: ZONE_INDUSTRIAL },
		];

		tick(city, commands);

		// Zoning should be applied
		expect(city.zoning[5 * 16 + 4]).toBe(ZONE_INDUSTRIAL);
		expect(city.zoning[5 * 16 + 6]).toBe(ZONE_INDUSTRIAL);

		// Road should exist
		expect(city.roads[5 * 16 + 5]).toBe(1);

		// I demand should be positive (base demand)
		expect(city.aggregates[AGG.I_DEMAND]).toBeGreaterThan(0);
	});

	it("full growth cycle: I→R→C feedback loop", () => {
		const city = smallCity();
		// Growth no longer needs power, but unpowered tiles take a land-value
		// penalty that stalls the feedback loop. Fund the city and power it.
		city.aggregates[AGG.DEBUG_INFINITE_MONEY] = 1;

		// Lay out roads in a cross pattern through the middle
		const roadCmds: Command[] = [];
		for (let i = 2; i < 14; i++) {
			roadCmds.push({ kind: "build-road", x: i, y: 8 });
			roadCmds.push({ kind: "build-road", x: 8, y: i });
		}
		// Coal plant wired to the road spine at (8,13) powers the whole grid.
		roadCmds.push({
			kind: "place-civic",
			x: 8,
			y: 14,
			civicType: CIVIC_COAL_PLANT,
		});
		tick(city, roadCmds);

		// Zone industrial near roads
		const iCmds: Command[] = [];
		for (let i = 2; i < 7; i++) {
			iCmds.push({ kind: "zone", x: i, y: 7, zoneType: ZONE_INDUSTRIAL });
			iCmds.push({ kind: "zone", x: i, y: 9, zoneType: ZONE_INDUSTRIAL });
		}
		tick(city, iCmds);

		// Run ticks to let I demand build and I tiles get occupied
		for (let t = 0; t < 30; t++) {
			tick(city, []);
		}

		// I buildings should have appeared
		let iBuildings = 0;
		for (let i = 0; i < city.size; i++) {
			if (
				city.zoning[i] === ZONE_INDUSTRIAL &&
				city.building[i] !== BUILDING_EMPTY
			) {
				iBuildings++;
			}
		}
		expect(iBuildings).toBeGreaterThan(0);

		// Now zone residential
		const rCmds: Command[] = [];
		for (let i = 9; i < 14; i++) {
			rCmds.push({ kind: "zone", x: i, y: 7, zoneType: ZONE_RESIDENTIAL });
			rCmds.push({ kind: "zone", x: i, y: 9, zoneType: ZONE_RESIDENTIAL });
		}
		tick(city, rCmds);

		// Run more ticks — R should build (jobs exist from I)
		for (let t = 0; t < 30; t++) {
			tick(city, []);
		}

		const totalPop = city.aggregates[AGG.TOTAL_POP] ?? 0;
		expect(totalPop).toBeGreaterThan(0);

		// Zone commercial
		const cCmds: Command[] = [];
		for (let i = 2; i < 7; i++) {
			cCmds.push({ kind: "zone", x: 7, y: i, zoneType: ZONE_COMMERCIAL });
			cCmds.push({ kind: "zone", x: 9, y: i, zoneType: ZONE_COMMERCIAL });
		}
		tick(city, cCmds);

		// Run even more ticks — C should build (population exists)
		for (let t = 0; t < 30; t++) {
			tick(city, []);
		}

		const totalCJobs = city.aggregates[AGG.TOTAL_C_JOBS] ?? 0;
		expect(totalCJobs).toBeGreaterThan(0);
	});

	it("is fully deterministic: same seed + commands = same state", () => {
		function runSimulation() {
			const city = createCity({ width: 16, height: 16, seed: 12345 });

			const setup: Command[] = [
				{ kind: "build-road", x: 8, y: 8 },
				{ kind: "zone", x: 7, y: 8, zoneType: ZONE_INDUSTRIAL },
				{ kind: "zone", x: 9, y: 8, zoneType: ZONE_RESIDENTIAL },
				{ kind: "zone", x: 8, y: 7, zoneType: ZONE_COMMERCIAL },
			];

			tick(city, setup);

			for (let t = 0; t < 100; t++) {
				tick(city, []);
			}

			return {
				tick: city.aggregates[AGG.TICK],
				treasury: city.aggregates[AGG.TREASURY],
				rDemand: city.aggregates[AGG.R_DEMAND],
				cDemand: city.aggregates[AGG.C_DEMAND],
				iDemand: city.aggregates[AGG.I_DEMAND],
				pop: city.aggregates[AGG.TOTAL_POP],
				landValues: Array.from(city.landValue),
				buildings: Array.from(city.building),
			};
		}

		const a = runSimulation();
		const b = runSimulation();

		expect(a.tick).toBe(b.tick);
		expect(a.treasury).toBe(b.treasury);
		expect(a.rDemand).toBe(b.rDemand);
		expect(a.cDemand).toBe(b.cDemand);
		expect(a.iDemand).toBe(b.iDemand);
		expect(a.pop).toBe(b.pop);
		expect(a.landValues).toEqual(b.landValues);
		expect(a.buildings).toEqual(b.buildings);
	});

	it("tax changes affect treasury growth", () => {
		const city = smallCity();

		// Setup: roads + zones
		const setup: Command[] = [
			{ kind: "build-road", x: 8, y: 8 },
			{ kind: "zone", x: 7, y: 8, zoneType: ZONE_RESIDENTIAL },
			{ kind: "zone", x: 9, y: 8, zoneType: ZONE_INDUSTRIAL },
		];
		tick(city, setup);

		// Run a while then raise taxes
		for (let t = 0; t < 50; t++) {
			tick(city, []);
		}

		const treasuryBefore = city.aggregates[AGG.TREASURY] ?? 0;

		tick(city, [{ kind: "set-tax-rate", sector: "r", rate: 0.2 }]);

		for (let t = 0; t < 50; t++) {
			tick(city, []);
		}

		// Treasury should have changed (exact direction depends on
		// whether increased revenue outweighs reduced growth)
		const treasuryAfter = city.aggregates[AGG.TREASURY] ?? 0;
		expect(treasuryAfter).not.toBe(treasuryBefore);
	});
});

/**
 * `applyEdits` is what a paused city runs. Building while paused must leave the
 * simulation exactly where it was — no growth, no settlement, no calendar —
 * while still showing the player the consequences of what they just placed.
 */
describe("applyEdits", () => {
	function zonedBlock(): Command[] {
		const cmds: Command[] = [
			{ kind: "build-road", x: 8, y: 8 },
			{ kind: "place-civic", x: 8, y: 9, civicType: CIVIC_COAL_PLANT },
		];
		for (let x = 5; x <= 7; x++) {
			cmds.push({ kind: "zone", x, y: 8, zoneType: ZONE_RESIDENTIAL });
		}
		return cmds;
	}

	it("never advances the clock", () => {
		const city = smallCity();
		applyEdits(city, zonedBlock());
		expect(city.aggregates[AGG.TICK]).toBe(0);
	});

	it("grows nothing on the land it zones", () => {
		const city = smallCity();
		// Enough repeats that a tick-driven grower would certainly have built.
		for (let i = 0; i < 50; i++) {
			applyEdits(city, zonedBlock());
		}

		for (let x = 5; x <= 7; x++) {
			expect(city.building[8 * 16 + x]).toBe(BUILDING_EMPTY);
		}
		expect(city.aggregates[AGG.TOTAL_POP]).toBe(0);
	});

	it("settles no taxes and pays no maintenance", () => {
		const city = smallCity();
		applyEdits(city, zonedBlock());
		const treasury = city.aggregates[AGG.TREASURY] ?? 0;

		for (let i = 0; i < 50; i++) {
			applyEdits(city, []);
		}
		expect(city.aggregates[AGG.TREASURY]).toBe(treasury);
	});

	it("still refreshes the layers the edit changed", () => {
		const city = smallCity();
		applyEdits(city, zonedBlock());

		// The plant lights up the road and the zoned tiles it reaches.
		expect(city.power[8 * 16 + 8]).toBe(1);
		expect(city.power[8 * 16 + 7]).toBe(1);
		// Land value capitalizes the new road access without a tick running.
		expect(city.landValue[8 * 16 + 7]).toBeGreaterThan(0);
	});

	it("reports how many commands changed the city", () => {
		const city = smallCity();
		expect(applyEdits(city, [{ kind: "build-road", x: 2, y: 2 }])).toBe(1);
		expect(applyEdits(city, [{ kind: "build-road", x: 2, y: 2 }])).toBe(0);
	});

	// The render shell rebakes when the revision moves. Paused edits leave TICK
	// alone, so without this the road would be applied but never drawn.
	it("bumps the revision when — and only when — something changed", () => {
		const city = smallCity();
		const start = city.aggregates[AGG.REVISION] ?? 0;

		applyEdits(city, [{ kind: "build-road", x: 2, y: 2 }]);
		const afterEdit = city.aggregates[AGG.REVISION] ?? 0;
		expect(afterEdit).toBeGreaterThan(start);

		applyEdits(city, [{ kind: "build-road", x: 2, y: 2 }]);
		expect(city.aggregates[AGG.REVISION]).toBe(afterEdit);

		tick(city, []);
		expect(city.aggregates[AGG.REVISION]).toBeGreaterThan(afterEdit);
	});

	// Enacting a policy moves no tile, so it must not report a change and must
	// not rebake — but the modifier bus still has to see it, or a policy enacted
	// while the sim is paused would sit inert until a tick that may never come.
	it("rebuilds the modifier bus for a governance command without a rebake", () => {
		const city = smallCity();
		const revision = city.aggregates[AGG.REVISION] ?? 0;

		const changed = applyEdits(city, [
			{ kind: "enact-policy", policyId: POLICY_UPZONING_MANDATE },
		]);

		expect(changed).toBe(0);
		expect(city.aggregates[AGG.REVISION]).toBe(revision);
		expect(city.policies[POLICY_UPZONING_MANDATE]).not.toBe(0);
		expect(city.modifiers[MOD.R_DEMAND_ADD]).toBe(60);
	});
});

/**
 * The governance systems are only worth anything if the sim reads them. These
 * are the end-to-end checks that a policy enacted through a command reaches the
 * systems that consume its channels.
 */
describe("governance wiring", () => {
	it("shifts RCI demand toward the enacted policy's target", () => {
		const plain = smallCity();
		const upzoned = smallCity();
		void applyEdits(upzoned, [
			{ kind: "enact-policy", policyId: POLICY_UPZONING_MANDATE },
		]);

		// Long enough for the demand lerp to close most of the gap.
		for (let i = 0; i < 60; i++) {
			tick(plain, []);
			tick(upzoned, []);
		}

		const gap =
			(upzoned.aggregates[AGG.R_DEMAND] ?? 0) -
			(plain.aggregates[AGG.R_DEMAND] ?? 0);
		// Settles at the declared +60, not at 60/DEMAND_SMOOTHING — the shift
		// joins the target, so it cannot feed back into its own input.
		expect(gap).toBeGreaterThan(50);
		expect(gap).toBeLessThanOrEqual(60);
	});

	it("scales maintenance by the modifier bus", () => {
		const plain = smallCity();
		const austere = smallCity();
		void applyEdits(austere, [
			{ kind: "enact-policy", policyId: POLICY_AUSTERITY_BUDGET },
		]);

		const roads: Command[] = [];
		for (let x = 0; x < 16; x++) roads.push({ kind: "build-road", x, y: 4 });
		void applyEdits(plain, roads);
		void applyEdits(austere, roads);

		tick(plain, []);
		tick(austere, []);

		expect(austere.aggregates[AGG.ROAD_COST]).toBeCloseTo(
			(plain.aggregates[AGG.ROAD_COST] ?? 0) * 0.85,
			10,
		);
	});

	it("accrues influence weekly once the sim is running", () => {
		const city = smallCity();
		const start = city.aggregates[AGG.INFLUENCE] ?? 0;

		for (let i = 0; i < DAYS_PER_WEEK * 2; i++) tick(city, []);

		// Two settlements at the flat base, with no services and no commitments.
		expect(city.aggregates[AGG.INFLUENCE]).toBe(
			start + INFLUENCE_BASE_PER_WEEK * 2,
		);
	});
});
