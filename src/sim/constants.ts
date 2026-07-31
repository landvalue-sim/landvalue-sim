// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
export const DEFAULT_WIDTH = 256;
export const DEFAULT_HEIGHT = 256;
export const MAX_GRID_SIZE = 256;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
export const TERRAIN_LAND = 0;
export const TERRAIN_WATER = 1;

// Tile corners, named by their position in the iso view. Each maps to a vertex
// of the (width+1) x (height+1) corner-height grid: N = (x, y), E = (x+1, y),
// S = (x+1, y+1), W = (x, y+1). CORNER_ALL targets the whole tile.
export const CORNER_N = 0;
export const CORNER_E = 1;
export const CORNER_S = 2;
export const CORNER_W = 3;
export const CORNER_ALL = 4;

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
// Power demand per building tier (indexed by density: 0=empty, 1=low, 2=med, 3=high).
// TODO: scale demand by the population living/working on the tile rather than
// by density tier alone, with a per-zone scalar (R/C/I draw differently per
// head — industry heaviest, residential lightest). See WATER_DEMAND_PER_DENSITY.
export const POWER_DEMAND_PER_DENSITY = [0, 1, 3, 8] as const;

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
// Each active pump (adjacent to water terrain) supplies this many units.
export const WATER_OUTPUT_PER_PUMP = 50;
// Water demand per building tier (indexed by density: 0=empty, 1=low, 2=med, 3=high).
// TODO: same rework as POWER_DEMAND_PER_DENSITY — drive off population/jobs on
// the tile with per-zone scalars instead of a flat per-tier lookup.
export const WATER_DEMAND_PER_DENSITY = [0, 1, 2, 5] as const;
export const COST_WATER_PIPE = 5;
export const PIPE_MAINTENANCE_COST = 0.05;

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
export const COST_TERRAFORM = 25;
export const COST_PLACE_WATER = 50;
export const COST_DRAIN_WATER = 25;

// Civic building maintenance per tick (indexed by CIVIC_* constant).
// Indices: 0=none, 1=coal, 2=solar, 3=pump, 4=police, 5=fire, 6=hospital,
//          7=school, 8=college, 9=library, 10=park, 11=stadium
export const CIVIC_MAINTENANCE = [
	0, 5, 2, 1, 4, 4, 6, 2.5, 5, 2, 0.5, 10,
] as const;
export const RAIL_MAINTENANCE_COST = 0.15;

// Civic placement costs (indexed by CIVIC_* constant).
export const CIVIC_COST_TABLE = [
	0,
	COST_COAL_PLANT,
	COST_SOLAR_PLANT,
	COST_WATER_PUMP,
	COST_POLICE,
	COST_FIRE_STATION,
	COST_HOSPITAL,
	COST_SCHOOL,
	COST_COLLEGE,
	COST_LIBRARY,
	COST_PARK,
	COST_STADIUM,
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
export const ROAD_MAINTENANCE_COST = 0.08;
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 0.2;

// ---------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------
export const WATER_THRESHOLD = 0.35;
export const ELEVATION_MAX = 15;
// Generated water fills every tile fully at or below this corner height.
export const SEA_LEVEL = Math.floor(WATER_THRESHOLD * ELEVATION_MAX);
// Highest generated land rises this far above the shoreline. Kept well below
// ELEVATION_MAX so fresh maps are mostly buildable plains; players can still
// terraform up to ELEVATION_MAX by hand.
export const GEN_LAND_RELIEF = 5;

/**
 * Longest side, in tiles, that one terraform drag may cover.
 *
 * Terraforming is not one write per tile. Levelling a tile re-slopes the ground
 * up to ELEVATION_MAX rings around it, and every tile in the rectangle ripples
 * its own neighbourhood again, so both the work and the undo records grow with
 * the area. Uncapped, a full-map level drag blocks the worker for many seconds
 * and writes several times more records than an undo arena holds — which drops
 * the entire history, including the very edit the player would most want back.
 *
 * 64 is the largest square whose worst case still fits. That worst case is flat
 * sea-level ground levelled to ELEVATION_MAX, far enough from any map edge that
 * nothing clips the ripple: 102,414 of the 131,072 vertex records and 88,306 of
 * the tile records. Both roughly quadruple when the side doubles, so 80 already
 * overruns the vertex arena. `undo.test.ts` pins this against the arena sizes.
 *
 * Every other tool writes one record per tile and needs no cap: a full-map
 * rectangle on the largest supported map is 65,536 records, half an arena.
 */
export const MAX_TERRAFORM_DRAG_SIDE = 64;

// ---------------------------------------------------------------------------
// Influence — political capital, the currency of government action
//
// Money buys concrete; influence buys permission. The cap is low on purpose:
// the resource is about choosing between government actions, not hoarding.
// See design_docs/INFLUENCE-AND-SITUATIONS.md.
// ---------------------------------------------------------------------------
export const MAX_INFLUENCE = 1000;
export const STARTING_INFLUENCE = 100;
// Accrual is deliberately O(1) — every term is an aggregate an earlier system
// already published, so influence buys no extra grid pass.
export const INFLUENCE_BASE_PER_WEEK = 5;
export const INFLUENCE_EDUCATION_BONUS = 3;
export const INFLUENCE_HEALTH_BONUS = 2;
export const INFLUENCE_CRIME_PENALTY = 4;
/**
 * Crime points per resident at which the crime penalty is fully applied.
 * Normalising per head means a large, well-policed city is not automatically
 * less governable than a small one with the same crime *rate*.
 *
 * A placeholder value — it wants tuning against a real city once situations
 * are generating pressure.
 */
export const INFLUENCE_CRIME_SATURATION = 4;

// ---------------------------------------------------------------------------
// Modifier bus — the one channel through which policies and situations reach
// the sim. Recomputed from scratch every tick (see systems/modifiers.ts).
//
// Every channel here is read O(1): at the top of a system, or once per weekly
// settlement. Per-tile channels are affordable too but cost a multiply across
// the whole grid every tick whether or not anything is modifying them, so they
// get added one at a time with a profile behind each.
// ---------------------------------------------------------------------------
export const MOD = {
	R_DEMAND_ADD: 0,
	C_DEMAND_ADD: 1,
	I_DEMAND_ADD: 2,
	TAX_REVENUE_MULT: 3,
	MAINTENANCE_MULT: 4,
	INFLUENCE_INCOME_ADD: 5,
	COUNT: 6,
} as const;

/**
 * Value each channel resets to before policies and situations accumulate onto
 * it. Additive channels start at 0, multiplicative ones at 1. Indices line up
 * with MOD.* — `modifiers.test.ts` pins the length against MOD.COUNT.
 */
export const MOD_BASE = [0, 0, 0, 1, 1, 0] as const;

// ---------------------------------------------------------------------------
// Situations — Stellaris-style ongoing conditions with a progress bar
// ---------------------------------------------------------------------------
export const MAX_SITUATIONS = 8;

/** Field offsets within one situation slot (see the `situations` Int32Array). */
export const SIT = {
	/** Definition id; 0 (SITUATION_NONE) marks the slot empty. */
	DEF: 0,
	/** Fixed-point milli-percent, 0..SITUATION_PROGRESS_MAX. */
	PROGRESS: 1,
	STAGE: 2,
	/** 0 = no approach chosen, else 1-based index into the def's approaches. */
	APPROACH: 3,
	START_TICK: 4,
	/** Last month's progress change, milli-percent. Readout only. */
	LAST_DELTA: 5,
	STRIDE: 6,
} as const;

/**
 * Progress is an integer in thousandths of a percent rather than a float 0..1.
 * Repeatedly adding a float delta to a float bar drifts, and a bar that stops a
 * ten-thousandth short of its threshold is a bug that only surfaces after an
 * hour of play. Integers make the comparison exact.
 */
export const SITUATION_PROGRESS_MAX = 100_000;

/**
 * Progress a situation opens at when its template does not say. Non-zero on
 * purpose: a situation that opened at zero could be defused by the first
 * approach the player picked, in the first month, before it ever mattered.
 */
export const SITUATION_START_PROGRESS = 20_000;

/**
 * Caps on authored content, so every loop over a definition has a bound that
 * does not depend on what a template happens to contain. The loader rejects
 * anything past them rather than letting it through to be silently truncated.
 */
export const MAX_SITUATION_DEFS = 64;
export const MAX_SITUATION_STAGES = 8;
export const MAX_SITUATION_APPROACHES = 6;

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export const START_YEAR = 1900;
// One tick advances the sim by one in-game day. Months and years use a fixed
// 30-day / 360-day calendar (no variable month lengths) so the date math stays
// trivial and deterministic. Public finance settles once per 7-day week.
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 360;

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
	// Last weekly settlement's public-finance breakdown, for the finances UI.
	REVENUE: 11,
	ROAD_COST: 12,
	// Power / water / infrastructure. *_SERVED is the demand the network
	// actually reached before capacity ran out; the gap against *_DEMAND is the
	// load stranded past the supply frontier (see systems/utility-network.ts).
	POWER_CAPACITY: 13,
	POWER_DEMAND: 14,
	POWER_SERVED: 15,
	WATER_CAPACITY: 16,
	WATER_DEMAND: 17,
	WATER_SERVED: 18,
	CIVIC_COST: 19,
	RAIL_COST: 20,
	PIPE_COST: 21,
	// P2 systems
	EDUCATION_LEVEL: 22,
	HEALTH_LEVEL: 23,
	TOTAL_CRIME: 24,
	BOND_PAYMENT: 25,
	FIRE_COUNT: 26,
	CONNECTION_COUNT: 27,
	TRAFFIC_CONGESTION: 28,
	// Bond slots: remaining months for up to 10 bonds (0 = inactive)
	BOND_SLOT_0: 29,
	BOND_SLOT_1: 30,
	BOND_SLOT_2: 31,
	BOND_SLOT_3: 32,
	BOND_SLOT_4: 33,
	BOND_SLOT_5: 34,
	BOND_SLOT_6: 35,
	BOND_SLOT_7: 36,
	BOND_SLOT_8: 37,
	BOND_SLOT_9: 38,
	// Debug cheats (0 = off, 1 = on). Stored in shared state so the sim systems
	// running in the worker can read them deterministically.
	DEBUG_INFINITE_MONEY: 39,
	/**
	 * Bumped every time the city's visible state changes — by a tick, by a
	 * player edit applied while paused, or by an undo. The render shell keys its
	 * cached world bake off this rather than off TICK, which stands still while
	 * the sim is paused even as the player keeps building.
	 */
	REVISION: 40,
	// Governance. Influence is the stock; income and upkeep are the last weekly
	// settlement's flows, kept for the readout. SITUATION_COUNT mirrors the
	// occupied slots in the situation pool so the HUD never scans it.
	INFLUENCE: 41,
	INFLUENCE_INCOME: 42,
	INFLUENCE_UPKEEP: 43,
	SITUATION_COUNT: 44,
	COUNT: 45,
} as const;
