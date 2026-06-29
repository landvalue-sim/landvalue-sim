// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
export const DEFAULT_WIDTH = 64;
export const DEFAULT_HEIGHT = 64;
export const MAX_GRID_SIZE = 256;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
export const TERRAIN_LAND = 0;
export const TERRAIN_WATER = 1;

// ---------------------------------------------------------------------------
// Zoning
// ---------------------------------------------------------------------------
export const ZONE_NONE = 0;
export const ZONE_RESIDENTIAL = 1;
export const ZONE_COMMERCIAL = 2;
export const ZONE_INDUSTRIAL = 3;

// ---------------------------------------------------------------------------
// Buildings — type implied by zone, value encodes density tier
// 0 = empty, 1 = low, 2 = medium, 3 = high
// ---------------------------------------------------------------------------
export const BUILDING_EMPTY = 0;
export const BUILDING_LOW = 1;
export const BUILDING_MED = 2;
export const BUILDING_HIGH = 3;

// ---------------------------------------------------------------------------
// Population / jobs per density tier
// ---------------------------------------------------------------------------
export const POP_PER_DENSITY = [0, 10, 30, 80] as const;
export const JOBS_C_PER_DENSITY = [0, 15, 40, 100] as const;
export const JOBS_I_PER_DENSITY = [0, 10, 25, 60] as const;

// ---------------------------------------------------------------------------
// RCI demand tuning
// ---------------------------------------------------------------------------
export const MAX_DEMAND = 1000;
export const DEMAND_SMOOTHING = 0.15;
export const RESIDENTS_PER_JOB = 2.5;
export const COMMERCIAL_PER_POP = 0.05;
export const INDUSTRIAL_BASE_DEMAND = 80;
export const INDUSTRIAL_PER_POP = 0.002;
export const TAX_NEUTRAL_RATE = 0.07;
export const TAX_DEMAND_PENALTY = 600;
export const DEFAULT_TAX_RATE = 0.07;

// ---------------------------------------------------------------------------
// Land value
// ---------------------------------------------------------------------------
export const LV_BASE = 10;
export const LV_ROAD_BONUS = 15;
export const LV_ROAD_ADJ_BONUS = 8;
export const LV_COMMERCIAL_BONUS = 4;
export const LV_POPULATION_BONUS = 3;
export const LV_INDUSTRIAL_PENALTY = 12;
export const LV_POLLUTION_FACTOR = 2;
export const LV_DIFFUSION_RATE = 0.15;
export const LV_DIFFUSION_ITERATIONS = 3;

// ---------------------------------------------------------------------------
// Migration / growth
// ---------------------------------------------------------------------------
export const MAX_BUILDS_PER_TICK = 4;
export const GROWTH_DEMAND_THRESHOLD = 50;
export const ABANDON_DEMAND_THRESHOLD = -300;
export const MAX_ABANDONS_PER_TICK = 2;

// ---------------------------------------------------------------------------
// Externalities
// ---------------------------------------------------------------------------
export const POLLUTION_PER_INDUSTRIAL = 25;
export const POLLUTION_SPREAD_RADIUS = 4;
export const POLLUTION_DECAY = 0.6;
export const MAX_POLLUTION = 255;

// ---------------------------------------------------------------------------
// Public finance
// ---------------------------------------------------------------------------
export const STARTING_TREASURY = 10000;
// Per-resident upkeep. Tuned so a basic road-served city with some commercial
// breaks even: break-even residential land value ≈ pop(10) * cost / taxRate
// ≈ 10 * 0.15 / 0.07 ≈ 21, which road-adjacent tiles reach. Higher values make
// population an unaffordable liability (see DESIGN.md land-value economics).
export const SERVICE_COST_PER_POP = 0.15;
export const ROAD_MAINTENANCE_COST = 0.08;
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 0.2;

// ---------------------------------------------------------------------------
// Aggregate state layout (indices into Float64Array)
// ---------------------------------------------------------------------------
export const AGG = {
	TICK: 0,
	TREASURY: 1,
	TAX_RATE_R: 2,
	TAX_RATE_C: 3,
	TAX_RATE_I: 4,
	R_DEMAND: 5,
	C_DEMAND: 6,
	I_DEMAND: 7,
	TOTAL_POP: 8,
	TOTAL_C_JOBS: 9,
	TOTAL_I_JOBS: 10,
	// Last tick's public-finance breakdown (per tick), for the finances UI.
	REVENUE: 11,
	SERVICE_COST: 12,
	ROAD_COST: 13,
	COUNT: 14,
} as const;
