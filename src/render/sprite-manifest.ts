import {
	CIVIC_COAL_PLANT,
	CIVIC_COLLEGE,
	CIVIC_FIRE_STATION,
	CIVIC_HOSPITAL,
	CIVIC_LIBRARY,
	CIVIC_PARK,
	CIVIC_POLICE,
	CIVIC_SCHOOL,
	CIVIC_SOLAR_PLANT,
	CIVIC_STADIUM,
	CIVIC_WATER_PUMP,
} from "../sim/constants.ts";

/**
 * Sprite asset manifest — defines every building sprite the renderer can load.
 *
 * Each entry maps a file in `public/sprites/` to a zone + density + footprint
 * (for zoned buildings) or a civic type constant (for civic buildings).
 * The renderer loads these in `preload()` and registers them at `create()`,
 * overriding procedural placeholders for any sprite whose file exists.
 *
 * Images can be any resolution — the renderer auto-scales them to fit the
 * tile footprint width. Generate with Nano Banana 2 (or any tool), drop the
 * PNG in `public/sprites/`, and it just works.
 */

// ---- Types ------------------------------------------------------------------

export interface SpriteManifestEntry {
	/** Phaser texture key (must be unique). */
	readonly key: string;
	/** Path relative to the public root (served by Vite). */
	readonly path: string;
	/** Zone: "r" | "c" | "i". */
	readonly zone: "r" | "c" | "i";
	/** Density tier: 1 (low), 2 (medium), 3 (high). */
	readonly density: 1 | 2 | 3;
	/** Footprint width in tiles. */
	readonly tileW: number;
	/** Footprint depth in tiles. */
	readonly tileH: number;
	/** Whether this is a cluster sprite (multi-tile) or solo (1x1). */
	readonly cluster: boolean;
	/** Sprite origin X (0-1). Default 0.5 = horizontal center. */
	readonly originX: number;
	/** Sprite origin Y (0-1). Default 1.0 = bottom edge. */
	readonly originY: number;
}

export interface CivicManifestEntry {
	/** Phaser texture key (must be unique). */
	readonly key: string;
	/** Path relative to the public root (served by Vite). */
	readonly path: string;
	/** Civic type constant (CIVIC_COAL_PLANT, etc.). */
	readonly civicType: number;
	readonly originX: number;
	readonly originY: number;
}

// ---- Helpers ----------------------------------------------------------------

function civic(civicType: number, name: string): CivicManifestEntry {
	return {
		key: `asset_civic_${name}`,
		path: `sprites/civic_${name}.png`,
		civicType,
		originX: 0.5,
		originY: 1.0,
	};
}

// TODO: building variety. Each zone+density currently maps to a single sprite,
// so every building of a kind looks identical. Later, give each zone+density a
// list of variant sprites and pick one per tile. The pick MUST be deterministic
// (no Math.random) — derive the index from the tile via the seeded PRNG keyed by
// tile index, so a tile renders the same building across frames and reloads.
function solo(zone: "r" | "c" | "i", density: 1 | 2 | 3): SpriteManifestEntry {
	return {
		key: `asset_${zone}${density}`,
		path: `sprites/bldg_${zone}${density}.png`,
		zone,
		density,
		tileW: 1,
		tileH: 1,
		cluster: false,
		originX: 0.5,
		originY: 1.0,
	};
}

function cluster(
	zone: "r" | "c" | "i",
	density: 1 | 2 | 3,
	footprint: 2 | 3,
): SpriteManifestEntry {
	return {
		key: `asset_${zone}${density}_${footprint}x${footprint}`,
		path: `sprites/bldg_${zone}${density}_${footprint}x${footprint}.png`,
		zone,
		density,
		tileW: footprint,
		tileH: footprint,
		cluster: true,
		originX: 0.5,
		originY: 1.0,
	};
}

// ---- Manifest ---------------------------------------------------------------

/**
 * All building sprites the renderer will attempt to load.
 *
 * Images are auto-scaled to fit the tile footprint — any resolution works.
 * The renderer measures the loaded texture width and computes the scale as:
 *   scale = footprintWidthPx / textureWidth
 * where footprintWidthPx = (tileW + tileH) * HALF_W.
 *
 * Entries are constructed below via the solo()/cluster() helpers, which derive
 * each key, path, and footprint from the zone + density.
 */
export const SPRITE_MANIFEST: readonly SpriteManifestEntry[] = [
	// Residential — solo
	solo("r", 1),
	solo("r", 2),
	solo("r", 3),
	// Residential — cluster
	cluster("r", 2, 2),
	cluster("r", 3, 3),

	// Commercial — solo
	solo("c", 1),
	solo("c", 2),
	solo("c", 3),
	// Commercial — cluster
	cluster("c", 2, 2),
	cluster("c", 3, 3),

	// Industrial — solo
	solo("i", 1),
	solo("i", 2),
	solo("i", 3),
	// Industrial — cluster
	cluster("i", 2, 2),
	cluster("i", 3, 3),
];

/** Civic building sprites (1x1 each, indexed by CIVIC_* constant). */
export const CIVIC_MANIFEST: readonly CivicManifestEntry[] = [
	civic(CIVIC_COAL_PLANT, "coal_plant"),
	civic(CIVIC_SOLAR_PLANT, "solar_plant"),
	civic(CIVIC_WATER_PUMP, "water_pump"),
	civic(CIVIC_POLICE, "police"),
	civic(CIVIC_FIRE_STATION, "fire_station"),
	civic(CIVIC_HOSPITAL, "hospital"),
	civic(CIVIC_SCHOOL, "school"),
	civic(CIVIC_COLLEGE, "college"),
	civic(CIVIC_LIBRARY, "library"),
	civic(CIVIC_PARK, "park"),
	civic(CIVIC_STADIUM, "stadium"),
];
