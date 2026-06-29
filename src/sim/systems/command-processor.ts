/**
 * Command processor — applies queued player commands to city state.
 * Runs first in the tick pipeline so all subsequent systems see the
 * player's latest changes.
 *
 * Each placement command checks the treasury and deducts a construction
 * cost. If the player cannot afford it, the command is silently skipped.
 */

import type { CityState } from "../city-state.ts";
import type { Command } from "../commands.ts";
import {
	AGG,
	BUILDING_EMPTY,
	CIVIC_NONE,
	COST_COAL_PLANT,
	COST_DEMOLISH,
	COST_POWER_LINE,
	COST_RAIL,
	COST_ROAD,
	COST_SOLAR_PLANT,
	COST_WATER_PUMP,
	COST_ZONE_HIGH,
	COST_ZONE_LOW,
	COST_ZONE_MED,
	DENSITY_HIGH,
	DENSITY_LOW,
	DENSITY_MED,
	MAX_GRID_SIZE,
	MAX_TAX_RATE,
	MIN_TAX_RATE,
	TERRAIN_WATER,
	ZONE_NONE,
} from "../constants.ts";
import { invariant } from "../invariant.ts";

// A single rectangle drag can zone an entire grid at once, so the cap is the
// whole-grid tile count (still a fixed, provable upper bound — NASA rule 2).
const MAX_COMMANDS_PER_TICK = MAX_GRID_SIZE * MAX_GRID_SIZE;

export function processCommands(
	state: CityState,
	commands: ReadonlyArray<Command>,
): void {
	const limit = Math.min(commands.length, MAX_COMMANDS_PER_TICK);

	for (let i = 0; i < limit; i++) {
		const cmd = commands[i];
		invariant(cmd !== undefined, "command missing at index");
		applyCommand(state, cmd);
	}
}

function canAfford(state: CityState, cost: number): boolean {
	return (state.aggregates[AGG.TREASURY] ?? 0) >= cost;
}

function charge(state: CityState, cost: number): void {
	state.aggregates[AGG.TREASURY] = (state.aggregates[AGG.TREASURY] ?? 0) - cost;
}

function zoneCost(density: number): number {
	if (density === DENSITY_HIGH) return COST_ZONE_HIGH;
	if (density === DENSITY_MED) return COST_ZONE_MED;
	return COST_ZONE_LOW;
}

function civicCost(civicType: number): number {
	switch (civicType) {
		case 1:
			return COST_COAL_PLANT;
		case 2:
			return COST_SOLAR_PLANT;
		case 3:
			return COST_WATER_PUMP;
		default:
			return 0;
	}
}

function applyCommand(state: CityState, cmd: Command): void {
	switch (cmd.kind) {
		case "zone":
			applyZone(state, cmd.x, cmd.y, cmd.zoneType, cmd.density);
			break;
		case "build-road":
			applyBuildRoad(state, cmd.x, cmd.y);
			break;
		case "build-rail":
			applyBuildRail(state, cmd.x, cmd.y);
			break;
		case "build-power-line":
			applyBuildPowerLine(state, cmd.x, cmd.y);
			break;
		case "place-civic":
			applyPlaceCivic(state, cmd.x, cmd.y, cmd.civicType);
			break;
		case "demolish":
			applyDemolish(state, cmd.x, cmd.y);
			break;
		case "set-tax-rate":
			applySetTaxRate(state, cmd.sector, cmd.rate);
			break;
	}
}

function applyZone(
	state: CityState,
	x: number,
	y: number,
	zoneType: number,
	density?: number,
): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;
	if (state.roads[idx] === 1) return;
	if (state.rail[idx] === 1) return;
	if (state.powerLines[idx] === 1) return;
	if ((state.civic[idx] ?? 0) !== CIVIC_NONE) return;

	const dens = density ?? DENSITY_LOW;

	// De-zoning is free
	if (zoneType === ZONE_NONE) {
		state.zoning[idx] = ZONE_NONE;
		state.densityCap[idx] = 0;
		state.building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
		return;
	}

	const cost = zoneCost(dens);
	if (!canAfford(state, cost)) return;
	charge(state, cost);

	state.zoning[idx] = zoneType;
	state.densityCap[idx] = dens;

	// If re-zoning occupied land to a different type or lower density, clear
	if (state.building[idx] !== BUILDING_EMPTY) {
		state.building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
	}
}

function applyBuildRoad(state: CityState, x: number, y: number): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;
	if (state.roads[idx] === 1) return; // already a road
	if (!canAfford(state, COST_ROAD)) return;
	charge(state, COST_ROAD);

	clearTile(state, idx);
	state.roads[idx] = 1;
}

function applyBuildRail(state: CityState, x: number, y: number): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;
	if (state.rail[idx] === 1) return;
	if (!canAfford(state, COST_RAIL)) return;
	charge(state, COST_RAIL);

	clearTile(state, idx);
	state.rail[idx] = 1;
}

function applyBuildPowerLine(state: CityState, x: number, y: number): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;
	if (state.powerLines[idx] === 1) return;
	if (!canAfford(state, COST_POWER_LINE)) return;
	charge(state, COST_POWER_LINE);

	clearTile(state, idx);
	state.powerLines[idx] = 1;
}

function applyPlaceCivic(
	state: CityState,
	x: number,
	y: number,
	civicType: number,
): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;
	const cost = civicCost(civicType);
	if (!canAfford(state, cost)) return;
	charge(state, cost);

	clearTile(state, idx);
	state.civic[idx] = civicType;
}

function applyDemolish(state: CityState, x: number, y: number): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (!canAfford(state, COST_DEMOLISH)) return;
	charge(state, COST_DEMOLISH);

	clearTile(state, idx);
}

/** Reset all layers on a single tile to empty land. */
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

function applySetTaxRate(
	state: CityState,
	sector: "r" | "c" | "i",
	rate: number,
): void {
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
}
