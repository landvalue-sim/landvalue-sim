// Public API for the simulation core

export type { CityState, CreateCityOptions } from "./city-state.ts";
export {
	cityByteLength,
	createCity,
	inBounds,
	tileIndex,
	viewCity,
} from "./city-state.ts";

export type {
	BuildPowerLineCommand,
	BuildRailCommand,
	BuildRoadCommand,
	Command,
	DemolishCommand,
	PlaceCivicCommand,
	SetTaxRateCommand,
	ZoneCommand,
} from "./commands.ts";
export {
	AGG,
	BUILDING_EMPTY,
	BUILDING_HIGH,
	BUILDING_LOW,
	BUILDING_MED,
	CIVIC_COAL_PLANT,
	CIVIC_NONE,
	CIVIC_SOLAR_PLANT,
	CIVIC_WATER_PUMP,
	COST_COAL_PLANT,
	COST_SOLAR_PLANT,
	COST_WATER_PUMP,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	DENSITY_HIGH,
	DENSITY_LOW,
	DENSITY_MED,
	MAX_DEMAND,
	MAX_TAX_RATE,
	MIN_TAX_RATE,
	START_YEAR,
	TERRAIN_LAND,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
export type { PrngState } from "./prng.ts";
export { createPrng, nextFloat, nextInt, nextU32 } from "./prng.ts";
export type { ProfileSnapshot, SystemStats } from "./profiler.ts";
export { getProfileSnapshot, SYSTEM_NAMES } from "./profiler.ts";
export { buildTestCity } from "./scenarios.ts";
export type { Violation } from "./sim-invariants.ts";
export { clearViolations, getViolations } from "./sim-invariants.ts";
export { generateTerrain } from "./terrain-gen.ts";
export { tick } from "./tick.ts";
