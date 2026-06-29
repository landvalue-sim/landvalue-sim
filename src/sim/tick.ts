/**
 * Tick — the fixed-step simulation loop.
 *
 * Runs all systems in a deterministic order each tick:
 *   1. Command processor (apply player input)
 *   2. Power coverage (BFS from plants)
 *   3. Water coverage (radius from pumps)
 *   4. Civic coverage (police, fire, education, health)
 *   5. Connections (edge detection)
 *   6. Traffic (commute congestion)
 *   7. RCI demand (economic feedback)
 *   8. Land value (amenity capitalization)
 *   9. Migration (buildings appear / upgrade / abandon)
 *  10. Externalities (pollution + traffic emissions)
 *  11. Crime (density, police, unemployment)
 *  12. Fire (ignition, spread, containment)
 *  13. Public finance (taxes, services, bonds)
 *  14. Postcondition invariants (dev only)
 *
 * The simulation is fully deterministic: same seed + same commands =
 * same state. Never uses Math.random() or Date.now().
 */

import type { CityState } from "./city-state.ts";
import type { Command } from "./commands.ts";
import { AGG } from "./constants.ts";
import {
	profilerSystemEnd,
	profilerSystemStart,
	profilerTickEnd,
	profilerTickStart,
	systemIndex,
} from "./profiler.ts";
import { checkAggregates, checkGridIntegrity } from "./sim-invariants.ts";
import { updateCivicCoverage } from "./systems/civic-coverage.ts";
import { processCommands } from "./systems/command-processor.ts";
import { updateConnections } from "./systems/connections.ts";
import { updateCrime } from "./systems/crime.ts";
import { updateExternalities } from "./systems/externalities.ts";
import { updateFire } from "./systems/fire.ts";
import { updateLandValue } from "./systems/land-value.ts";
import { processMigration } from "./systems/migration.ts";
import { updatePower } from "./systems/power.ts";
import { updatePublicFinance } from "./systems/public-finance.ts";
import { updateRciDemand } from "./systems/rci-demand.ts";
import { updateTraffic } from "./systems/traffic.ts";
import { updateWater } from "./systems/water.ts";

// Pre-compute system indices so we don't look them up every tick
const IDX_COMMANDS = systemIndex("commands");
const IDX_POWER = systemIndex("power");
const IDX_WATER = systemIndex("water");
const IDX_CIVIC_COVERAGE = systemIndex("civicCoverage");
const IDX_CONNECTIONS = systemIndex("connections");
const IDX_TRAFFIC = systemIndex("traffic");
const IDX_RCI = systemIndex("rciDemand");
const IDX_LAND_VALUE = systemIndex("landValue");
const IDX_MIGRATION = systemIndex("migration");
const IDX_EXTERNALITIES = systemIndex("externalities");
const IDX_CRIME = systemIndex("crime");
const IDX_FIRE = systemIndex("fire");
const IDX_PUBLIC_FINANCE = systemIndex("publicFinance");
const IDX_INVARIANTS = systemIndex("invariants");

export function tick(state: CityState, commands: ReadonlyArray<Command>): void {
	profilerTickStart();

	let t: number;

	t = profilerSystemStart();
	processCommands(state, commands);
	profilerSystemEnd(IDX_COMMANDS, t);

	t = profilerSystemStart();
	updatePower(state);
	profilerSystemEnd(IDX_POWER, t);

	t = profilerSystemStart();
	updateWater(state);
	profilerSystemEnd(IDX_WATER, t);

	t = profilerSystemStart();
	updateCivicCoverage(state);
	profilerSystemEnd(IDX_CIVIC_COVERAGE, t);

	t = profilerSystemStart();
	updateConnections(state);
	profilerSystemEnd(IDX_CONNECTIONS, t);

	t = profilerSystemStart();
	updateTraffic(state);
	profilerSystemEnd(IDX_TRAFFIC, t);

	t = profilerSystemStart();
	updateRciDemand(state);
	profilerSystemEnd(IDX_RCI, t);

	t = profilerSystemStart();
	updateLandValue(state);
	profilerSystemEnd(IDX_LAND_VALUE, t);

	t = profilerSystemStart();
	processMigration(state);
	profilerSystemEnd(IDX_MIGRATION, t);

	t = profilerSystemStart();
	updateExternalities(state);
	profilerSystemEnd(IDX_EXTERNALITIES, t);

	t = profilerSystemStart();
	updateCrime(state);
	profilerSystemEnd(IDX_CRIME, t);

	t = profilerSystemStart();
	updateFire(state);
	profilerSystemEnd(IDX_FIRE, t);

	t = profilerSystemStart();
	updatePublicFinance(state);
	profilerSystemEnd(IDX_PUBLIC_FINANCE, t);

	const currentTick = state.aggregates[AGG.TICK] ?? 0;
	state.aggregates[AGG.TICK] = currentTick + 1;

	// Postcondition checks (dev only — stripped in production)
	t = profilerSystemStart();
	if (import.meta.env.DEV) {
		checkAggregates(state);
		checkGridIntegrity(state);
	}
	profilerSystemEnd(IDX_INVARIANTS, t);

	profilerTickEnd();
}
