/**
 * Command processor — applies queued player commands to city state.
 * Runs first in the tick pipeline so all subsequent systems see the
 * player's latest changes.
 */

import type { CityState } from "../city-state.ts";
import type { Command } from "../commands.ts";
import {
	AGG,
	BUILDING_EMPTY,
	MAX_TAX_RATE,
	MIN_TAX_RATE,
	TERRAIN_WATER,
	ZONE_NONE,
} from "../constants.ts";
import { invariant } from "../invariant.ts";

const MAX_COMMANDS_PER_TICK = 256;

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

function applyCommand(state: CityState, cmd: Command): void {
	switch (cmd.kind) {
		case "zone":
			applyZone(state, cmd.x, cmd.y, cmd.zoneType);
			break;
		case "build-road":
			applyBuildRoad(state, cmd.x, cmd.y);
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
): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;
	if (state.roads[idx] === 1) return; // can't zone on a road

	state.zoning[idx] = zoneType;

	// De-zoning clears the building
	if (zoneType === ZONE_NONE) {
		state.building[idx] = BUILDING_EMPTY;
		state.population[idx] = 0;
		state.jobs[idx] = 0;
	}
}

function applyBuildRoad(state: CityState, x: number, y: number): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;
	if (state.terrain[idx] === TERRAIN_WATER) return;

	// Building a road clears the zone and building
	state.roads[idx] = 1;
	state.zoning[idx] = ZONE_NONE;
	state.building[idx] = BUILDING_EMPTY;
	state.population[idx] = 0;
	state.jobs[idx] = 0;
}

function applyDemolish(state: CityState, x: number, y: number): void {
	if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
	const idx = y * state.width + x;

	state.roads[idx] = 0;
	state.zoning[idx] = ZONE_NONE;
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
