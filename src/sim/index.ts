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
	IssueBondCommand,
	PlaceCivicCommand,
	SetTaxRateCommand,
	ZoneCommand,
} from "./commands.ts";
export {
	AGG,
	BOND_AMOUNT,
	BOND_MONTHLY_PAYMENT,
	BUILDING_EMPTY,
	BUILDING_HIGH,
	BUILDING_LOW,
	BUILDING_MED,
	CIVIC_COAL_PLANT,
	CIVIC_COLLEGE,
	CIVIC_FIRE_STATION,
	CIVIC_HOSPITAL,
	CIVIC_LIBRARY,
	CIVIC_NONE,
	CIVIC_PARK,
	CIVIC_POLICE,
	CIVIC_SCHOOL,
	CIVIC_SOLAR_PLANT,
	CIVIC_STADIUM,
	CIVIC_TYPE_COUNT,
	CIVIC_WATER_PUMP,
	COST_COAL_PLANT,
	COST_COLLEGE,
	COST_FIRE_STATION,
	COST_HOSPITAL,
	COST_LIBRARY,
	COST_PARK,
	COST_POLICE,
	COST_SCHOOL,
	COST_SOLAR_PLANT,
	COST_STADIUM,
	COST_WATER_PUMP,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	DENSITY_HIGH,
	DENSITY_LOW,
	DENSITY_MED,
	MAX_BONDS,
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
