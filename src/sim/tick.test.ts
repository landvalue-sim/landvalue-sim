import { describe, expect, it } from "vitest";
import { createCity } from "./city-state.ts";
import type { Command } from "./commands.ts";
import {
	AGG,
	BUILDING_EMPTY,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
import { tick } from "./tick.ts";

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

		// Lay out roads in a cross pattern through the middle
		const roadCmds: Command[] = [];
		for (let i = 2; i < 14; i++) {
			roadCmds.push({ kind: "build-road", x: i, y: 8 });
			roadCmds.push({ kind: "build-road", x: 8, y: i });
		}
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
