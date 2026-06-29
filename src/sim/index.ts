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
	BuildRoadCommand,
	Command,
	DemolishCommand,
	SetTaxRateCommand,
	ZoneCommand,
} from "./commands.ts";
export {
	AGG,
	BUILDING_EMPTY,
	BUILDING_HIGH,
	BUILDING_LOW,
	BUILDING_MED,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	MAX_DEMAND,
	MAX_TAX_RATE,
	MIN_TAX_RATE,
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
export { tick } from "./tick.ts";
