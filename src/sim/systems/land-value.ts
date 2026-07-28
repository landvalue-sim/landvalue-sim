/**
 * Land value field — amenity capitalization and diffusion.
 *
 * Each tile's land value is computed from:
 *   - Base terrain value
 *   - Road access (on road or adjacent to road)
 *   - Rail adjacency (transit capitalization)
 *   - Waterfront adjacency
 *   - Elevation bonus
 *   - Nearby commercial activity (positive for R tiles)
 *   - Nearby population (positive for C tiles)
 *   - Industrial proximity (negative)
 *   - Pollution (negative)
 *   - Power/water coverage penalties
 *
 * After raw values are computed, a diffusion pass smooths the field so
 * value radiates outward from amenities.
 *
 * The per-tile facts every neighbor scan needs (infrastructure, amenities,
 * occupied zoning) are packed into flag bytes once per update, and the grid
 * interior runs a fast path with precomputed neighbor offsets and no bounds
 * checks — only the border rows and columns pay for coordinate clamping.
 * The arithmetic is unchanged from the straightforward implementation; only
 * the traversal is restructured (issue #11).
 */

import { type CityState, inBounds } from "../city-state.ts";
import {
	BUILDING_EMPTY,
	CIVIC_PARK,
	CIVIC_STADIUM,
	LV_BASE,
	LV_COMMERCIAL_BONUS,
	LV_CRIME_FACTOR,
	LV_DIFFUSION_ITERATIONS,
	LV_DIFFUSION_RATE,
	LV_ELEVATION_FACTOR,
	LV_INDUSTRIAL_PENALTY,
	LV_NO_POWER_PENALTY,
	LV_NO_WATER_PENALTY,
	LV_PARK_BONUS,
	LV_POLLUTION_FACTOR,
	LV_POPULATION_BONUS,
	LV_RAIL_ADJ_BONUS,
	LV_ROAD_ADJ_BONUS,
	LV_STADIUM_BONUS,
	LV_TRAFFIC_FACTOR,
	LV_WATER_ADJ_BONUS,
	MAX_GRID_SIZE,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "../constants.ts";

// Pre-allocated scratch buffers for diffusion passes. The 3x1 row sums of
// masked values can reach 3 * 65535, so they need 32 bits.
const scratch = new Uint16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const eligible = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const maskedValue = new Uint16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const rowSum = new Uint32Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const rowCount = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

// Per-tile fact flags, rebuilt once per update.
const F_ROAD = 1;
const F_RAIL = 2;
const F_WATER = 4;
const F_PARK = 8;
const F_STADIUM = 16;
const F_PLINE = 32;
const F_CIVIC = 64;
// A tile with any of these is infrastructure/water, carries no parcel value,
// and sits outside the diffusion field. (Same set in both passes.)
const F_NOT_PARCEL = F_ROAD | F_RAIL | F_WATER | F_PLINE | F_CIVIC;
// Neighbors skipped when averaging during diffusion.
const F_SUM_SKIP = F_ROAD | F_RAIL;

const tileFlags = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);

// Orthogonal + diagonal neighbor offsets
const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;
const NEIGHBOR_COUNT = 8;

// Nibble-packed occupied-zone indicators (C at bit 0, R at bit 4, I at bit 8),
// their row 3-sums, and row 3-aggregates of flags and traffic for pass 1.
// A 3x3 count never exceeds 9, so the nibbles cannot carry into each other.
const ZC_C = 1;
const ZC_R = 1 << 4;
const ZC_I = 1 << 8;
const zoneCnt = new Uint16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const rowZoneCnt = new Uint16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const rowFlagOr = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const rowTrafficMax = new Uint8Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
// Occupied-zone indicator per zoning value, applied when a building exists.
const ZC_TABLE = new Uint16Array(4);
ZC_TABLE[ZONE_COMMERCIAL] = ZC_C;
ZC_TABLE[ZONE_RESIDENTIAL] = ZC_R;
ZC_TABLE[ZONE_INDUSTRIAL] = ZC_I;

// The neighbor-independent part of each parcel's raw value, and lookup tables
// for every floor-multiply term so the hot loops stay branch- and float-free.
// Each table entry precomputes the exact expression the direct code used.
const selfValue = new Int16Array(MAX_GRID_SIZE * MAX_GRID_SIZE);
const ELEV_BONUS = new Int16Array(256);
const CRIME_PENALTY = new Int16Array(256);
const TRAFFIC_PENALTY = new Int16Array(256);
for (let v = 0; v < 256; v++) {
	ELEV_BONUS[v] = Math.floor(v * LV_ELEVATION_FACTOR);
	CRIME_PENALTY[v] = Math.floor(v * LV_CRIME_FACTOR);
	TRAFFIC_PENALTY[v] = Math.floor(v * LV_TRAFFIC_FACTOR);
}
// Adjacency bonus for every combination of the five amenity flag bits.
const FLAG_BONUS_MASK = F_ROAD | F_RAIL | F_WATER | F_PARK | F_STADIUM;
const FLAG_BONUS = new Int16Array(FLAG_BONUS_MASK + 1);
for (let bits = 0; bits <= FLAG_BONUS_MASK; bits++) {
	let bonus = 0;
	if ((bits & F_ROAD) !== 0) bonus += LV_ROAD_ADJ_BONUS;
	if ((bits & F_RAIL) !== 0) bonus += LV_RAIL_ADJ_BONUS;
	if ((bits & F_WATER) !== 0) bonus += LV_WATER_ADJ_BONUS;
	if ((bits & F_PARK) !== 0) bonus += LV_PARK_BONUS;
	if ((bits & F_STADIUM) !== 0) bonus += LV_STADIUM_BONUS;
	FLAG_BONUS[bits] = bonus;
}

export function updateLandValue(state: CityState): void {
	const { width, height, traffic, landValue, zoning } = state;
	// Hoisted imported constants: under Vite's dev/test module transform an
	// imported binding is a namespace property read on every use, which is
	// ruinous inside per-tile loops. Locals compile to registers everywhere.
	const zoneR = ZONE_RESIDENTIAL;
	const zoneC = ZONE_COMMERCIAL;
	const zoneI = ZONE_INDUSTRIAL;
	const commercialBonus = LV_COMMERCIAL_BONUS;
	const populationBonus = LV_POPULATION_BONUS;
	const industrialPenalty = LV_INDUSTRIAL_PENALTY;

	buildTileIndex(state);
	buildRowAggregates(state);

	// --- Pass 1: compute raw values -----------------------------------------
	// The 8-neighbor facts come from the row aggregates: a 3x3 OR of flags is
	// the neighbor OR because a parcel's own flags are zero; the 3x3 count
	// minus the center indicator is the neighbor count; and the neighbor
	// traffic max is the up/down row maxes plus the two side tiles directly
	// (traffic on the center tile itself must not participate).
	for (let y = 0; y < height; y++) {
		const rowBase = y * width;
		const up = y > 0 ? -width : 0;
		const down = y < height - 1 ? width : 0;
		for (let x = 0; x < width; x++) {
			const i = rowBase + x;
			if (((tileFlags[i] ?? 0) & F_NOT_PARCEL) !== 0) {
				landValue[i] = 0;
				continue;
			}

			let nearFlags = rowFlagOr[i] ?? 0;
			let counts = (rowZoneCnt[i] ?? 0) - (zoneCnt[i] ?? 0);
			let maxTraffic = x > 0 ? (traffic[i - 1] ?? 0) : 0;
			const tRight = x < width - 1 ? (traffic[i + 1] ?? 0) : 0;
			if (tRight > maxTraffic) maxTraffic = tRight;
			if (up !== 0) {
				nearFlags |= rowFlagOr[i + up] ?? 0;
				counts += rowZoneCnt[i + up] ?? 0;
				const t = rowTrafficMax[i + up] ?? 0;
				if (t > maxTraffic) maxTraffic = t;
			}
			if (down !== 0) {
				nearFlags |= rowFlagOr[i + down] ?? 0;
				counts += rowZoneCnt[i + down] ?? 0;
				const t = rowTrafficMax[i + down] ?? 0;
				if (t > maxTraffic) maxTraffic = t;
			}

			let value =
				(selfValue[i] ?? 0) +
				(FLAG_BONUS[nearFlags & FLAG_BONUS_MASK] ?? 0) -
				(TRAFFIC_PENALTY[maxTraffic] ?? 0);

			// Nearby commercial boosts R land value; nearby population boosts C
			const zone = zoning[i];
			if (zone === zoneR) {
				value += (counts & 15) * commercialBonus;
			} else if (zone === zoneC) {
				value += ((counts >> 4) & 15) * populationBonus;
			}
			// Industrial penalty
			if (zone !== zoneI) {
				value -= ((counts >> 8) & 15) * industrialPenalty;
			}

			landValue[i] = value > 0 ? value : 0;
		}
	}

	// --- Pass 2: diffusion (bounded iterations) ------------------------------
	for (let iter = 0; iter < LV_DIFFUSION_ITERATIONS; iter++) {
		scratch.set(landValue);
		diffuseOnce(state);
	}
}

/** Row 3-window aggregates of flags, zone counts, and traffic for pass 1. */
function buildRowAggregates(state: CityState): void {
	const { width, height, traffic } = state;

	for (let y = 0; y < height; y++) {
		const first = y * width;
		const last = first + width - 1;
		if (width === 1) {
			rowFlagOr[first] = tileFlags[first] ?? 0;
			rowZoneCnt[first] = zoneCnt[first] ?? 0;
			rowTrafficMax[first] = traffic[first] ?? 0;
			continue;
		}

		rowFlagOr[first] = (tileFlags[first] ?? 0) | (tileFlags[first + 1] ?? 0);
		rowZoneCnt[first] = (zoneCnt[first] ?? 0) + (zoneCnt[first + 1] ?? 0);
		rowTrafficMax[first] = Math.max(
			traffic[first] ?? 0,
			traffic[first + 1] ?? 0,
		);
		for (let i = first + 1; i < last; i++) {
			rowFlagOr[i] =
				(tileFlags[i - 1] ?? 0) | (tileFlags[i] ?? 0) | (tileFlags[i + 1] ?? 0);
			rowZoneCnt[i] =
				(zoneCnt[i - 1] ?? 0) + (zoneCnt[i] ?? 0) + (zoneCnt[i + 1] ?? 0);
			const a = traffic[i - 1] ?? 0;
			const b = traffic[i] ?? 0;
			const c = traffic[i + 1] ?? 0;
			rowTrafficMax[i] = a > b ? (a > c ? a : c) : b > c ? b : c;
		}
		rowFlagOr[last] = (tileFlags[last - 1] ?? 0) | (tileFlags[last] ?? 0);
		rowZoneCnt[last] = (zoneCnt[last - 1] ?? 0) + (zoneCnt[last] ?? 0);
		rowTrafficMax[last] = Math.max(traffic[last - 1] ?? 0, traffic[last] ?? 0);
	}
}

/**
 * Rebuild the per-tile fact flags, the occupied-zoning index, and the
 * neighbor-independent part of each tile's raw value. Road, rail, and
 * power-line layers are 0/1, so their flag bits shift in branch-free.
 */
function buildTileIndex(state: CityState): void {
	const { size, terrain, roads, rail, powerLines, civic, zoning, building } =
		state;
	const { elevation, pollution, crime, power, waterCoverage } = state;
	// Hoisted imported constants — see updateLandValue.
	const water = TERRAIN_WATER;
	const park = CIVIC_PARK;
	const stadium = CIVIC_STADIUM;
	const empty = BUILDING_EMPTY;
	const base = LV_BASE;
	const pollutionFactor = LV_POLLUTION_FACTOR;
	const noPowerPenalty = LV_NO_POWER_PENALTY;
	const noWaterPenalty = LV_NO_WATER_PENALTY;

	// Three separate sweeps, not one: the grid layers are equal-sized slices
	// of one backing buffer, so they alias the same cache sets — streaming a
	// dozen at once thrashes; a few at a time stays fast.
	for (let i = 0; i < size; i++) {
		const c = civic[i] ?? 0;
		tileFlags[i] =
			(roads[i] ?? 0) |
			((rail[i] ?? 0) << 1) |
			(terrain[i] === water ? F_WATER : 0) |
			((powerLines[i] ?? 0) << 5) |
			(c !== 0 ? F_CIVIC : 0) |
			(c === park ? F_PARK : 0) |
			(c === stadium ? F_STADIUM : 0);
	}

	for (let i = 0; i < size; i++) {
		zoneCnt[i] = building[i] === empty ? 0 : (ZC_TABLE[zoning[i] ?? 0] ?? 0);
	}

	for (let i = 0; i < size; i++) {
		selfValue[i] =
			base +
			(ELEV_BONUS[elevation[i] ?? 0] ?? 0) -
			(pollution[i] ?? 0) * pollutionFactor -
			(CRIME_PENALTY[crime[i] ?? 0] ?? 0) -
			(power[i] !== 1 ? noPowerPenalty : 0) -
			(waterCoverage[i] !== 1 ? noWaterPenalty : 0);
	}
}

/**
 * One diffusion iteration: average each parcel toward its neighbors.
 *
 * The 8-neighbor sum and eligible-neighbor count are separable box sums:
 * a horizontal 3-wide pass followed by a vertical 3-tall combine, minus the
 * center tile. Integer addition is order-independent, so the totals — and
 * therefore the averages — are identical to visiting each neighbor.
 * Road and rail neighbors are masked out; water and other zero-value tiles
 * still count toward the average, exactly as the direct scan did.
 */
function diffuseOnce(state: CityState): void {
	const { width, height, size, landValue } = state;
	// Hoisted imported constant — see updateLandValue.
	const rate = LV_DIFFUSION_RATE;

	if (width < 2 || height < 2) {
		diffuseOnceDirect(state);
		return;
	}

	for (let i = 0; i < size; i++) {
		const e = ((tileFlags[i] ?? 0) & F_SUM_SKIP) === 0 ? 1 : 0;
		eligible[i] = e;
		maskedValue[i] = e === 1 ? (scratch[i] ?? 0) : 0;
	}

	// Horizontal 3-sums, row-clamped at the first and last column.
	for (let y = 0; y < height; y++) {
		const rowBase = y * width;
		const last = rowBase + width - 1;
		rowSum[rowBase] =
			(maskedValue[rowBase] ?? 0) + (maskedValue[rowBase + 1] ?? 0);
		rowCount[rowBase] = (eligible[rowBase] ?? 0) + (eligible[rowBase + 1] ?? 0);
		for (let i = rowBase + 1; i < last; i++) {
			rowSum[i] =
				(maskedValue[i - 1] ?? 0) +
				(maskedValue[i] ?? 0) +
				(maskedValue[i + 1] ?? 0);
			rowCount[i] =
				(eligible[i - 1] ?? 0) + (eligible[i] ?? 0) + (eligible[i + 1] ?? 0);
		}
		rowSum[last] = (maskedValue[last - 1] ?? 0) + (maskedValue[last] ?? 0);
		rowCount[last] = (eligible[last - 1] ?? 0) + (eligible[last] ?? 0);
	}

	// Vertical combine and write, column-clamped at the first and last row.
	for (let y = 0; y < height; y++) {
		const rowBase = y * width;
		const up = y > 0 ? -width : 0;
		const down = y < height - 1 ? width : 0;
		for (let x = 0; x < width; x++) {
			const i = rowBase + x;
			// Water, roads, rail, power lines are not part of the value field.
			if (((tileFlags[i] ?? 0) & F_NOT_PARCEL) !== 0) continue;

			let sum = (rowSum[i] ?? 0) - (maskedValue[i] ?? 0);
			let count = (rowCount[i] ?? 0) - (eligible[i] ?? 0);
			if (up !== 0) {
				sum += rowSum[i + up] ?? 0;
				count += rowCount[i + up] ?? 0;
			}
			if (down !== 0) {
				sum += rowSum[i + down] ?? 0;
				count += rowCount[i + down] ?? 0;
			}

			if (count > 0) {
				const avg = sum / count;
				const current = scratch[i] ?? 0;
				landValue[i] = Math.round(current + (avg - current) * rate);
			}
		}
	}
}

/** Direct 8-neighbor diffusion for degenerate 1-wide/1-tall maps. */
function diffuseOnceDirect(state: CityState): void {
	const { width, height, landValue } = state;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			if (((tileFlags[i] ?? 0) & F_NOT_PARCEL) !== 0) continue;

			let sum = 0;
			let count = 0;
			for (let n = 0; n < NEIGHBOR_COUNT; n++) {
				const nx = x + (DX[n] ?? 0);
				const ny = y + (DY[n] ?? 0);
				if (!inBounds(width, height, nx, ny)) continue;
				const ni = ny * width + nx;
				if (((tileFlags[ni] ?? 0) & F_SUM_SKIP) !== 0) continue;
				sum += scratch[ni] ?? 0;
				count++;
			}

			if (count > 0) {
				const avg = sum / count;
				const current = scratch[i] ?? 0;
				landValue[i] = Math.round(
					current + (avg - current) * LV_DIFFUSION_RATE,
				);
			}
		}
	}
}
