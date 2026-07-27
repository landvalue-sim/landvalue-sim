/**
 * Command processor — applies queued player commands to city state.
 * Runs first in the tick pipeline so all subsequent systems see the
 * player's latest changes.
 *
 * Each placement command checks the treasury and deducts a construction
 * cost. If the player cannot afford it, the command is silently skipped.
 *
 * Every `apply*` reports whether it actually mutated the city, and
 * `processCommands` sums those reports. Undo uses the total to decide whether a
 * batch is worth an undo step — a drag that lands entirely on tiles that
 * already hold what it would place changes nothing, and should not consume one.
 */

import type { CityState } from "../city-state.ts";
import type { Command } from "../commands.ts";
import {
	AGG,
	BOND_AMOUNT,
	BOND_MONTHLY_PAYMENT,
	BOND_TERM_MONTHS,
	BUILDING_EMPTY,
	CIVIC_COST_TABLE,
	CIVIC_NONE,
	COST_DEMOLISH,
	COST_DRAIN_WATER,
	COST_PLACE_WATER,
	COST_POWER_LINE,
	COST_RAIL,
	COST_ROAD,
	COST_TERRAFORM,
	COST_WATER_PIPE,
	DENSITY_LOW,
	MAX_BONDS,
	MAX_GRID_SIZE,
	MAX_TAX_RATE,
	MIN_TAX_RATE,
	TERRAIN_WATER,
	ZONE_NONE,
} from "../constants.ts";
import { invariant } from "../invariant.ts";
import { setWaterTile, terraformTile } from "../terraform.ts";

// A single rectangle drag can zone an entire grid at once, so the cap is the
// whole-grid tile count (still a fixed, provable upper bound — NASA rule 2).
const MAX_COMMANDS_PER_TICK = MAX_GRID_SIZE * MAX_GRID_SIZE;

/** Apply a batch; returns how many commands actually changed the city. */
export function processCommands(
	state: CityState,
	commands: ReadonlyArray<Command>,
): number {
	const limit = Math.min(commands.length, MAX_COMMANDS_PER_TICK);
	let changed = 0;

	for (let i = 0; i < limit; i++) {
		const cmd = commands[i];
		invariant(cmd !== undefined, "command missing at index");
		if (applyCommand(state, cmd)) changed++;
	}
	return changed;
}

function infiniteMoney(state: CityState): boolean {
	return (state.aggregates[AGG.DEBUG_INFINITE_MONEY] ?? 0) === 1;
}

function canAfford(state: CityState, cost: number): boolean {
	if (infiniteMoney(state)) return true;
	return (state.aggregates[AGG.TREASURY] ?? 0) >= cost;
}

function charge(state: CityState, cost: number): void {
	if (infiniteMoney(state)) return;
	state.aggregates[AGG.TREASURY] = (state.aggregates[AGG.TREASURY] ?? 0) - cost;
}

function civicCost(civicType: number): number {
	return CIVIC_COST_TABLE[civicType] ?? 0;
}

function applyCommand(state: CityState, cmd: Command): boolean {
	switch (cmd.kind) {
		case "zone":
			return applyZone(state, cmd.x, cmd.y, cmd.zoneType, cmd.density);
		case "build-road":
			return applyBuildRoad(state, cmd.x, cmd.y);
		case "build-rail":
			return applyBuildRail(state, cmd.x, cmd.y);
		case "build-power-line":
			return applyBuildPowerLine(state, cmd.x, cmd.y);
		case "build-water-pipe":
			return applyBuildWaterPipe(state, cmd.x, cmd.y);
		case "place-civic":
			return applyPlaceCivic(state, cmd.x, cmd.y, cmd.civicType);
		case "demolish":
			return applyDemolish(state, cmd.x, cmd.y);
		case "demolish-pipe":
			return applyDemolishPipe(state, cmd.x, cmd.y);
		case "terraform":
			return applyTerraform(state, cmd.x, cmd.y, cmd.corner, cmd.dir);
		case "set-water":
			return applySetWater(state, cmd.x, cmd.y, cmd.place);
		case "set-tax-rate":
			return applySetTaxRate(state, cmd.sector, cmd.rate);
		case "issue-bond":
			return applyIssueBond(state);
	}
}

function applyZone(
	state: CityState,
	x: number,
	y: number,
	zoneType: number,
	density?: number,
): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.roads[idx] === 1) return false;
	if (state.rail[idx] === 1) return false;
	if (state.powerLines[idx] === 1) return false;
	if ((state.civic[idx] ?? 0) !== CIVIC_NONE) return false;

	const dens = density ?? DENSITY_LOW;
	const hadBuilding = state.building[idx] !== BUILDING_EMPTY;

	// De-zoning is free
	if (zoneType === ZONE_NONE) {
		if (state.zoning[idx] === ZONE_NONE && !hadBuilding) return false;
		state.zoning[idx] = ZONE_NONE;
		state.densityCap[idx] = 0;
		state.building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
		return true;
	}

	if (
		state.zoning[idx] === zoneType &&
		state.densityCap[idx] === dens &&
		!hadBuilding
	) {
		return false;
	}

	state.zoning[idx] = zoneType;
	state.densityCap[idx] = dens;

	// If re-zoning occupied land to a different type or lower density, clear
	if (hadBuilding) {
		state.building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
	}
	return true;
}

function applyBuildRoad(state: CityState, x: number, y: number): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.roads[idx] === 1) return false; // already a road
	if (!canAfford(state, COST_ROAD)) return false;
	charge(state, COST_ROAD);

	clearTile(state, idx);
	state.roads[idx] = 1;
	return true;
}

function applyBuildRail(state: CityState, x: number, y: number): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.rail[idx] === 1) return false;
	if (!canAfford(state, COST_RAIL)) return false;
	charge(state, COST_RAIL);

	clearTile(state, idx);
	state.rail[idx] = 1;
	return true;
}

function applyBuildPowerLine(state: CityState, x: number, y: number): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.powerLines[idx] === 1) return false;
	if (!canAfford(state, COST_POWER_LINE)) return false;
	charge(state, COST_POWER_LINE);

	clearTile(state, idx);
	state.powerLines[idx] = 1;
	return true;
}

/** Pipes are underground — they coexist with whatever is on the surface. */
function applyBuildWaterPipe(state: CityState, x: number, y: number): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	if (state.waterPipes[idx] === 1) return false;
	if (!canAfford(state, COST_WATER_PIPE)) return false;
	charge(state, COST_WATER_PIPE);
	state.waterPipes[idx] = 1;
	return true;
}

function applyPlaceCivic(
	state: CityState,
	x: number,
	y: number,
	civicType: number,
): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return false;
	const cost = civicCost(civicType);
	if (!canAfford(state, cost)) return false;
	charge(state, cost);

	clearTile(state, idx);
	state.civic[idx] = civicType;
	return true;
}

function applyDemolish(state: CityState, x: number, y: number): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	// Bare land holds nothing to remove. Charging for it would bill a
	// rectangle drag for every empty tile it happens to sweep over.
	if (!tileHasSurface(state, idx)) return false;
	if (!canAfford(state, COST_DEMOLISH)) return false;
	charge(state, COST_DEMOLISH);

	clearTile(state, idx);
	return true;
}

/** Remove only the underground water pipe on a tile, leaving surface intact. */
function applyDemolishPipe(state: CityState, x: number, y: number): boolean {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
	const idx = y * state.width + x;
	if (state.waterPipes[idx] !== 1) return false;
	if (!canAfford(state, COST_DEMOLISH)) return false;
	charge(state, COST_DEMOLISH);
	state.waterPipes[idx] = 0;
	return true;
}

function applyTerraform(
	state: CityState,
	x: number,
	y: number,
	corner: number,
	dir: number,
): boolean {
	if (!canAfford(state, COST_TERRAFORM)) return false;
	if (!terraformTile(state, x, y, corner, dir)) return false;
	charge(state, COST_TERRAFORM);
	return true;
}

function applySetWater(
	state: CityState,
	x: number,
	y: number,
	place: boolean,
): boolean {
	const cost = place ? COST_PLACE_WATER : COST_DRAIN_WATER;
	if (!canAfford(state, cost)) return false;
	if (!setWaterTile(state, x, y, place)) return false;
	charge(state, cost);
	return true;
}

/** Whether the tile carries anything `clearTile` would erase. */
function tileHasSurface(state: CityState, idx: number): boolean {
	return (
		state.roads[idx] === 1 ||
		state.rail[idx] === 1 ||
		state.powerLines[idx] === 1 ||
		(state.civic[idx] ?? 0) !== CIVIC_NONE ||
		(state.zoning[idx] ?? 0) !== ZONE_NONE ||
		(state.building[idx] ?? 0) !== BUILDING_EMPTY
	);
}

/**
 * Reset the *surface* layers on a single tile to empty land.
 *
 * Underground layers (currently `waterPipes`; metros and tunnels will join
 * them) are deliberately untouched — they occupy a separate vertical space and
 * survive anything built above. Each underground layer owns a dedicated
 * demolish command; see `applyDemolishPipe`. Adding a new underground layer
 * means adding it to that list, never to this function.
 */
function clearTile(state: CityState, idx: number): void {
	state.roads[idx] = 0;
	state.rail[idx] = 0;
	state.powerLines[idx] = 0;
	state.civic[idx] = CIVIC_NONE;
	state.zoning[idx] = ZONE_NONE;
	state.densityCap[idx] = 0;
	state.building[idx] = BUILDING_EMPTY;
	state.population[idx] = 0;
	state.jobs[idx] = 0;
}

/**
 * Take out a bond. Reported as a change so it gets its own undo step: undo
 * restores the bond aggregates alongside the treasury (see undo.ts), and
 * without a step of its own the proceeds could be rolled back by a later undo
 * while the debt stayed on the books.
 */
function applyIssueBond(state: CityState): boolean {
	const agg = state.aggregates;
	// Find an empty bond slot
	for (let i = 0; i < MAX_BONDS; i++) {
		const slotIdx = AGG.BOND_SLOT_0 + i;
		if ((agg[slotIdx] ?? 0) <= 0) {
			agg[slotIdx] = BOND_TERM_MONTHS;
			agg[AGG.TREASURY] = (agg[AGG.TREASURY] ?? 0) + BOND_AMOUNT;
			agg[AGG.BOND_PAYMENT] =
				(agg[AGG.BOND_PAYMENT] ?? 0) + BOND_MONTHLY_PAYMENT;
			return true;
		}
	}
	// All slots full — silently reject
	return false;
}

function applySetTaxRate(
	state: CityState,
	sector: "r" | "c" | "i",
	rate: number,
): boolean {
	const clamped = Math.max(MIN_TAX_RATE, Math.min(MAX_TAX_RATE, rate));
	switch (sector) {
		case "r":
			state.aggregates[AGG.TAX_RATE_R] = clamped;
			break;
		case "c":
			state.aggregates[AGG.TAX_RATE_C] = clamped;
			break;
		case "i":
			state.aggregates[AGG.TAX_RATE_I] = clamped;
			break;
	}
	// Rates live in the aggregates, which undo does not snapshot — reporting a
	// change here would spend an undo step that could never take effect.
	return false;
}
