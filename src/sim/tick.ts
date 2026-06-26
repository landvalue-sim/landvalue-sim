/**
 * Tick — the fixed-step simulation loop.
 *
 * Runs all systems in a deterministic order each tick:
 *   1. Command processor (apply player input)
 *   2. RCI demand (economic feedback)
 *   3. Land value (amenity capitalization)
 *   4. Migration (buildings appear / abandon)
 *   5. Externalities (pollution)
 *   6. Public finance (taxes, services)
 *
 * The simulation is fully deterministic: same seed + same commands =
 * same state. Never uses Math.random() or Date.now().
 */

import type { CityState } from "./city-state.ts";
import type { Command } from "./commands.ts";
import { AGG } from "./constants.ts";
import { processCommands } from "./systems/command-processor.ts";
import { updateExternalities } from "./systems/externalities.ts";
import { updateLandValue } from "./systems/land-value.ts";
import { processMigration } from "./systems/migration.ts";
import { updatePublicFinance } from "./systems/public-finance.ts";
import { updateRciDemand } from "./systems/rci-demand.ts";

export function tick(state: CityState, commands: ReadonlyArray<Command>): void {
	processCommands(state, commands);
	updateRciDemand(state);
	updateLandValue(state);
	processMigration(state);
	updateExternalities(state);
	updatePublicFinance(state);

	const currentTick = state.aggregates[AGG.TICK] ?? 0;
	state.aggregates[AGG.TICK] = currentTick + 1;
}
