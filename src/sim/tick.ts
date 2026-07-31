/**
 * Tick — the fixed-step simulation loop.
 *
 * Runs all systems in a deterministic order each tick:
 *   1. Command processor (apply player input)
 *   2. Modifiers (rebuild the governance bus)
 *   3. Power coverage (BFS from plants)
 *   4. Water coverage (BFS from pumps)
 *   5. Civic coverage (police, fire, education, health)
 *   6. Connections (edge detection)
 *   7. Traffic (commute congestion)
 *   8. RCI demand (economic feedback)
 *   9. Land value (amenity capitalization)
 *  10. Migration (buildings appear / upgrade / abandon)
 *  11. Externalities (pollution + traffic emissions)
 *  12. Crime (density, police, unemployment)
 *  13. Fire (ignition, spread, containment)
 *  14. Public finance (taxes, maintenance, bonds)
 *  15. Influence (weekly accrual and standing upkeep)
 *  16. Situations (monthly triggers, progress, stages)
 *  17. Postcondition invariants (dev only)
 *
 * The two governance systems bracket the pipeline for a reason. Modifiers are
 * rebuilt at the top so a policy enacted by a command this tick is live for the
 * rest of it; situations run at the bottom so their triggers read this tick's
 * aggregates rather than last tick's. See
 * design_docs/INFLUENCE-AND-SITUATIONS.md.
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
import {
	checkAggregates,
	checkGridIntegrity,
	checkSituations,
} from "./sim-invariants.ts";
import { updateCivicCoverage } from "./systems/civic-coverage.ts";
import { processCommands } from "./systems/command-processor.ts";
import { updateConnections } from "./systems/connections.ts";
import { updateCrime } from "./systems/crime.ts";
import { updateExternalities } from "./systems/externalities.ts";
import { updateFire } from "./systems/fire.ts";
import { updateInfluence } from "./systems/influence.ts";
import { updateLandValue } from "./systems/land-value.ts";
import { processMigration } from "./systems/migration.ts";
import { updateModifiers } from "./systems/modifiers.ts";
import { updatePower } from "./systems/power.ts";
import { updatePublicFinance } from "./systems/public-finance.ts";
import {
	createSupplyScratch,
	updateRciDemand,
	updateSupplyTotals,
} from "./systems/rci-demand.ts";
import { updateSituations } from "./systems/situations.ts";
import { updateTraffic } from "./systems/traffic.ts";
import { updateWater } from "./systems/water.ts";
import { beginStep, commitStep, type UndoJournal, undoStep } from "./undo.ts";

// Pre-compute system indices so we don't look them up every tick
const IDX_COMMANDS = systemIndex("commands");
const IDX_MODIFIERS = systemIndex("modifiers");
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
const IDX_INFLUENCE = systemIndex("influence");
const IDX_SITUATIONS = systemIndex("situations");
const IDX_INVARIANTS = systemIndex("invariants");

/**
 * Apply a batch of player edits *without* advancing the simulation, then
 * refresh the layers that are pure functions of the grid so the change reads
 * correctly on screen straight away. This is what an edit does while the sim
 * is paused: the road appears, its power and water coverage light up, land
 * value re-capitalizes — but nothing grows, no taxes settle, and the calendar
 * does not move. Returns how many commands actually changed the city.
 *
 * The whole batch is one undo step, so a drag is undone as the single gesture
 * the player made rather than tile by tile. `journal` may be null where undo is
 * not wanted (tests, headless replays).
 *
 * The systems called here are the ones that recompute their layer from scratch
 * rather than accumulating, which is what makes running them off-tick safe.
 * They are not the whole tick, though: land value in particular is normally
 * computed after traffic, so between ticks it reads a traffic layer the edit
 * has not refreshed. The next tick puts that right.
 */
export function applyEdits(
	state: CityState,
	commands: ReadonlyArray<Command>,
	journal: UndoJournal | null = null,
): number {
	beginStep(journal);
	const changed = processCommands(state, commands, journal);
	void commitStep(journal);
	// Unconditionally, and outside the `changed` branch. A governance command
	// moves no tile, so it reports no change and must not trigger a rebake — but
	// the bus still has to see it, or a policy enacted while the sim is paused
	// would sit inert until a tick that may never come. The rebuild is a few
	// dozen operations; running it on every batch costs nothing.
	updateModifiers(state);
	if (changed > 0) {
		refreshDerived(state);
		bumpRevision(state);
	}
	return changed;
}

/**
 * Roll back the most recent player edit and rebuild what depends on it.
 * Returns false when there is nothing left to undo.
 *
 * The revision only ever moves forward — rewinding it would leave the render
 * cache believing it was already current.
 */
export function undoEdit(state: CityState, journal: UndoJournal): boolean {
	if (!undoStep(journal, state)) return false;
	refreshDerived(state);
	bumpRevision(state);
	return true;
}

/**
 * Mark the city's visible state as changed. The render shell rebakes when this
 * moves, so anything that edits the city outside the tick loop — a paused
 * build, an undo — has to call it or the change will not be drawn.
 */
export function bumpRevision(state: CityState): void {
	state.aggregates[AGG.REVISION] = (state.aggregates[AGG.REVISION] ?? 0) + 1;
}

/**
 * Somewhere for `refreshDerived`'s supply pass to put the counts only the demand
 * model reads. Allocated once, at module load, and discarded on every use — the
 * demand curves keep their own (NASA rule 3).
 */
const refreshSupply = createSupplyScratch();

/**
 * Recompute every layer that is a pure function of the current grid. Used by
 * `applyEdits` and after an undo puts tiles back.
 *
 * `updateSupplyTotals` is in the list because bulldozing a block changes the
 * population the HUD reports, and while the sim is paused no tick will come
 * along to recount it. It is only the tally — the demand curves it normally
 * feeds stay where the last tick left them, since an edit is not a month.
 */
export function refreshDerived(state: CityState): void {
	updatePower(state);
	updateWater(state);
	updateCivicCoverage(state);
	updateConnections(state);
	updateLandValue(state);
	updateSupplyTotals(state, refreshSupply);
}

export function tick(state: CityState, commands: ReadonlyArray<Command>): void {
	profilerTickStart();

	let t: number;

	t = profilerSystemStart();
	void processCommands(state, commands);
	profilerSystemEnd(IDX_COMMANDS, t);

	t = profilerSystemStart();
	updateModifiers(state);
	profilerSystemEnd(IDX_MODIFIERS, t);

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

	t = profilerSystemStart();
	updateInfluence(state);
	profilerSystemEnd(IDX_INFLUENCE, t);

	t = profilerSystemStart();
	updateSituations(state);
	profilerSystemEnd(IDX_SITUATIONS, t);

	const currentTick = state.aggregates[AGG.TICK] ?? 0;
	state.aggregates[AGG.TICK] = currentTick + 1;
	bumpRevision(state);

	// Postcondition checks (dev only — stripped in production)
	t = profilerSystemStart();
	if (import.meta.env.DEV) {
		checkAggregates(state);
		checkGridIntegrity(state);
		checkSituations(state);
	}
	profilerSystemEnd(IDX_INVARIANTS, t);

	profilerTickEnd();
}
