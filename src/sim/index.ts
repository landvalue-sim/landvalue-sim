// Public API for the simulation core

export type { CityState, CreateCityOptions } from "./city-state.ts";
export {
	cityByteLength,
	createCity,
	inBounds,
	tileIndex,
	vertexIndex,
	viewCity,
} from "./city-state.ts";

export type {
	BuildPowerLineCommand,
	BuildRailCommand,
	BuildRoadCommand,
	BuildWaterPipeCommand,
	Command,
	DemolishCommand,
	DemolishPipeCommand,
	EnactPolicyCommand,
	IssueBondCommand,
	LevelTerrainCommand,
	PlaceCivicCommand,
	RepealPolicyCommand,
	SetSituationApproachCommand,
	SetTaxRateCommand,
	SetWaterCommand,
	TerraformCommand,
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
	CORNER_ALL,
	CORNER_E,
	CORNER_N,
	CORNER_S,
	CORNER_W,
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
	COST_WATER_PIPE,
	COST_WATER_PUMP,
	DAYS_PER_MONTH,
	DAYS_PER_WEEK,
	DAYS_PER_YEAR,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	DENSITY_HIGH,
	DENSITY_LOW,
	DENSITY_MED,
	ELEVATION_MAX,
	INFINITE_TREASURY,
	MAX_BONDS,
	MAX_DEMAND,
	MAX_INFLUENCE,
	MAX_SITUATIONS,
	MAX_TAX_RATE,
	MAX_TERRAFORM_DRAG_SIDE,
	MIN_TAX_RATE,
	MOD,
	MOD_BASE,
	SEA_LEVEL,
	SIT,
	SITUATION_PROGRESS_MAX,
	SITUATION_START_PROGRESS,
	START_YEAR,
	TERRAIN_LAND,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
export type { ModifierEffect } from "./modifier-effect.ts";
export { EFFECT_ADD, EFFECT_MULT } from "./modifier-effect.ts";
export type { PolicyDef } from "./policy-defs.ts";
export {
	POLICY_AUSTERITY_BUDGET,
	POLICY_CIVIC_OUTREACH,
	POLICY_COUNT,
	POLICY_DEFS,
	POLICY_UPZONING_MANDATE,
	policyDef,
} from "./policy-defs.ts";
export type { PrngState } from "./prng.ts";
export { createPrng, nextFloat, nextInt, nextU32 } from "./prng.ts";
export type { ProfileSnapshot, SystemStats } from "./profiler.ts";
export { getProfileSnapshot, SYSTEM_NAMES } from "./profiler.ts";
export { buildTestCity } from "./scenarios.ts";
export type { Violation } from "./sim-invariants.ts";
export { clearViolations, getViolations } from "./sim-invariants.ts";
export {
	SITUATION_DEF_COUNT,
	SITUATION_DEFS,
	requireSituationId,
	situationDef,
	situationIdByKey,
} from "./situation-defs.ts";
export { loadSituations, SITUATION_TEMPLATE_VERSION } from "./situation-loader.ts";
export type {
	SituationApproach,
	SituationBoundary,
	SituationDef,
	SituationOutcome,
	SituationStage,
	SituationTrigger,
} from "./situation-types.ts";
export {
	BOUNDARY_PIN,
	BOUNDARY_RESOLVE,
	SITUATION_NONE,
	TRIGGER_ABOVE,
	TRIGGER_BELOW,
} from "./situation-types.ts";
export {
	enactPolicy,
	repealPolicy,
	totalInfluenceUpkeep,
	weeklyInfluenceIncome,
} from "./systems/influence.ts";
export { updateModifiers } from "./systems/modifiers.ts";
export type { SituationSlotView } from "./systems/situations.ts";
export {
	countOpenSituations,
	createSituationSlotView,
	isSituationOpen,
	openSituation,
	readSituationSlot,
	setSituationApproach,
} from "./systems/situations.ts";
export { levelTile, setWaterTile, terraformTile } from "./terraform.ts";
export { generateTerrain } from "./terrain-gen.ts";
export {
	applyEdits,
	bumpRevision,
	refreshDerived,
	tick,
	undoEdit,
} from "./tick.ts";
export type { UndoJournal } from "./undo.ts";
export { clearJournal, createUndoJournal } from "./undo.ts";
