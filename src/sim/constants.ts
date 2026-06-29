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
// Density caps (player-controlled zoning density)
// ---------------------------------------------------------------------------
export const DENSITY_LOW = 1;
export const DENSITY_MED = 2;
export const DENSITY_HIGH = 3;

// ---------------------------------------------------------------------------
// Civic building types (stored in the civic layer)
// ---------------------------------------------------------------------------
export const CIVIC_NONE = 0;
export const CIVIC_COAL_PLANT = 1;
export const CIVIC_SOLAR_PLANT = 2;
export const CIVIC_WATER_PUMP = 3;
export const CIVIC_POLICE = 4;
export const CIVIC_FIRE_STATION = 5;
export const CIVIC_HOSPITAL = 6;
export const CIVIC_SCHOOL = 7;
export const CIVIC_COLLEGE = 8;
export const CIVIC_LIBRARY = 9;
export const CIVIC_PARK = 10;
export const CIVIC_STADIUM = 11;
export const CIVIC_TYPE_COUNT = 12;

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
// Education boosts C demand (educated workforce attracts commercial).
export const EDUCATION_C_DEMAND_BONUS = 0.3;
// Health boosts R growth rate.
export const HEALTH_GROWTH_BONUS = 0.2;

// ---------------------------------------------------------------------------
// Land value
// ---------------------------------------------------------------------------
export const LV_BASE = 10;
// Road access capitalizes into the adjacent developable land, not the roadbed
// itself (roads carry no parcel value — see land-value.ts).
export const LV_ROAD_ADJ_BONUS = 12;
export const LV_COMMERCIAL_BONUS = 4;
export const LV_POPULATION_BONUS = 3;
export const LV_INDUSTRIAL_PENALTY = 12;
export const LV_POLLUTION_FACTOR = 2;
export const LV_DIFFUSION_RATE = 0.15;
export const LV_DIFFUSION_ITERATIONS = 3;
export const LV_WATER_ADJ_BONUS = 6;
export const LV_ELEVATION_FACTOR = 0.5;
export const LV_RAIL_ADJ_BONUS = 8;
export const LV_NO_WATER_PENALTY = 4;
export const LV_NO_POWER_PENALTY = 8;
export const LV_CRIME_FACTOR = 1.5;
export const LV_TRAFFIC_FACTOR = 0.5;
export const LV_PARK_BONUS = 8;
export const LV_STADIUM_BONUS = 5;

// ---------------------------------------------------------------------------
// Migration / growth
// ---------------------------------------------------------------------------
export const MAX_BUILDS_PER_TICK = 4;
export const GROWTH_DEMAND_THRESHOLD = 50;
export const ABANDON_DEMAND_THRESHOLD = -300;
export const MAX_ABANDONS_PER_TICK = 2;
export const UPGRADE_DEMAND_THRESHOLD = 200;
export const MAX_UPGRADES_PER_TICK = 2;

// ---------------------------------------------------------------------------
// Externalities
// ---------------------------------------------------------------------------
export const POLLUTION_PER_INDUSTRIAL = 25;
export const POLLUTION_SPREAD_RADIUS = 4;
export const POLLUTION_DECAY = 0.6;
export const MAX_POLLUTION = 255;
export const TRAFFIC_POLLUTION_FACTOR = 0.3;

// ---------------------------------------------------------------------------
// Crime
// ---------------------------------------------------------------------------
export const CRIME_BASE = 5;
export const CRIME_DENSITY_FACTOR = 3;
export const CRIME_UNEMPLOYMENT_FACTOR = 0.1;
export const CRIME_LOW_VALUE_THRESHOLD = 15;
export const CRIME_LOW_VALUE_BONUS = 8;
export const CRIME_POLICE_SUPPRESSION = 0.7;
export const MAX_CRIME = 255;

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------
export const FIRE_BASE_RISK = 1;
export const FIRE_INDUSTRIAL_RISK = 4;
export const FIRE_DENSITY_RISK = 2;
export const FIRE_COVERAGE_SUPPRESSION = 0.8;
// Ignition chance is risk / FIRE_IGNITION_DIVISOR per tick (checked via PRNG).
export const FIRE_IGNITION_DIVISOR = 5000;
export const FIRE_SPREAD_CHANCE = 40;
export const FIRE_CONTAINMENT_CHANCE = 30;
export const FIRE_COVERED_CONTAINMENT_BONUS = 40;
export const MAX_FIRE_CHECKS_PER_TICK = 64;

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------
export const TRAFFIC_ROAD_CAPACITY = 100;
export const TRAFFIC_RAIL_CAPACITY = 200;
export const TRAFFIC_SPREAD_RADIUS = 6;
export const TRAFFIC_DECAY = 0.5;
export const MAX_TRAFFIC = 255;

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------
// Output in MW per civic type (indexed by CIVIC_* constant).
// Indices: 0=none, 1=coal, 2=solar, 3=pump, 4=police...11=stadium
export const POWER_OUTPUT = [0, 200, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
// Pollution emitted by power plants (indexed by CIVIC_* constant).
export const POWER_PLANT_POLLUTION = [
	0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
] as const;
export const POWER_DEMAND_PER_BUILDING = 1;

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
export const WATER_COVERAGE_RADIUS = 12;

// ---------------------------------------------------------------------------
// Civic building coverage radii (indexed by CIVIC_* constant)
// 0 = no coverage. Only service buildings have radii.
// ---------------------------------------------------------------------------
export const CIVIC_COVERAGE_RADIUS = [
	0, 0, 0, 0, 16, 15, 20, 15, 20, 15, 8, 12,
] as const;

// ---------------------------------------------------------------------------
// Construction costs (deducted from treasury on placement)
// ---------------------------------------------------------------------------
export const COST_ROAD = 10;
export const COST_RAIL = 20;
export const COST_POWER_LINE = 5;
export const COST_ZONE_LOW = 5;
export const COST_ZONE_MED = 10;
export const COST_ZONE_HIGH = 20;
export const COST_DEMOLISH = 1;
export const COST_COAL_PLANT = 5000;
export const COST_SOLAR_PLANT = 3000;
export const COST_WATER_PUMP = 500;
export const COST_POLICE = 500;
export const COST_FIRE_STATION = 500;
export const COST_HOSPITAL = 1000;
export const COST_SCHOOL = 250;
export const COST_COLLEGE = 1000;
export const COST_LIBRARY = 400;
export const COST_PARK = 100;
export const COST_STADIUM = 3000;

// Civic building maintenance per tick (indexed by CIVIC_* constant).
// Indices: 0=none, 1=coal, 2=solar, 3=pump, 4=police, 5=fire, 6=hospital,
//          7=school, 8=college, 9=library, 10=park, 11=stadium
export const CIVIC_MAINTENANCE = [
	0, 50, 20, 10, 40, 40, 60, 25, 50, 20, 5, 100,
] as const;
export const RAIL_MAINTENANCE_COST = 0.15;

// Civic placement costs (indexed by CIVIC_* constant).
export const CIVIC_COST_TABLE = [
	0, COST_COAL_PLANT, COST_SOLAR_PLANT, COST_WATER_PUMP, COST_POLICE,
	COST_FIRE_STATION, COST_HOSPITAL, COST_SCHOOL, COST_COLLEGE, COST_LIBRARY,
	COST_PARK, COST_STADIUM,
] as const;

// ---------------------------------------------------------------------------
// Bonds
// ---------------------------------------------------------------------------
export const BOND_AMOUNT = 5000;
export const BOND_TERM_MONTHS = 120;
export const BOND_INTEREST_RATE = 0.05;
// Monthly payment = principal * (r / (1 - (1+r)^-n)) where r = annual/12
export const BOND_MONTHLY_PAYMENT = (() => {
	const r = BOND_INTEREST_RATE / 12;
	return Math.round(BOND_AMOUNT * (r / (1 - (1 + r) ** -BOND_TERM_MONTHS)));
})();
export const MAX_BONDS = 10;

// ---------------------------------------------------------------------------
// Neighbor connections
// ---------------------------------------------------------------------------
export const CONNECTION_TRADE_BONUS = 0.1;
export const CONNECTION_DEMAND_BONUS = 30;

// ---------------------------------------------------------------------------
// Public finance
// ---------------------------------------------------------------------------
export const STARTING_TREASURY = 10000;
// Treasury value pinned each tick while the infinite-money debug cheat is on.
// Large enough that no single tick of construction can exhaust it.
export const INFINITE_TREASURY = 1_000_000_000;
// Per-resident upkeep. Tuned so a basic road-served city with some commercial
// breaks even: break-even residential land value ≈ pop(10) * cost / taxRate
// ≈ 10 * 0.15 / 0.07 ≈ 21, which road-adjacent tiles reach. Higher values make
// population an unaffordable liability (see DESIGN.md land-value economics).
export const SERVICE_COST_PER_POP = 0.15;
export const ROAD_MAINTENANCE_COST = 0.08;
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 0.2;

// ---------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------
export const WATER_THRESHOLD = 0.35;
export const ELEVATION_MAX = 15;

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export const START_YEAR = 1900;

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
	// Power / water / infrastructure
	POWER_CAPACITY: 14,
	POWER_DEMAND: 15,
	WATER_CAPACITY: 16,
	WATER_DEMAND: 17,
	CIVIC_COST: 18,
	RAIL_COST: 19,
	// P2 systems
	EDUCATION_LEVEL: 20,
	HEALTH_LEVEL: 21,
	TOTAL_CRIME: 22,
	BOND_PAYMENT: 23,
	FIRE_COUNT: 24,
	CONNECTION_COUNT: 25,
	TRAFFIC_CONGESTION: 26,
	// Bond slots: remaining months for up to 10 bonds (0 = inactive)
	BOND_SLOT_0: 27,
	BOND_SLOT_1: 28,
	BOND_SLOT_2: 29,
	BOND_SLOT_3: 30,
	BOND_SLOT_4: 31,
	BOND_SLOT_5: 32,
	BOND_SLOT_6: 33,
	BOND_SLOT_7: 34,
	BOND_SLOT_8: 35,
	BOND_SLOT_9: 36,
	// Debug cheats (0 = off, 1 = on). Stored in shared state so the sim systems
	// running in the worker can read them deterministically.
	DEBUG_INFINITE_MONEY: 37,
	COUNT: 38,
} as const;
