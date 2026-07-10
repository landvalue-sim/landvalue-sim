/**
 * Sprite asset manifest — defines every building sprite the renderer can load.
 *
 * Each entry maps a file in `public/sprites/` to a zone + density + footprint.
 * The renderer loads these in `preload()` and registers them at `create()`,
 * overriding procedural placeholders for any sprite whose file exists.
 *
 * Images can be any resolution — the renderer auto-scales them to fit the
 * tile footprint width. Generate with Nano Banana 2 (or any tool), drop the
 * PNG in `public/sprites/`, and it just works.
 *
 * See `design_docs/SPRITE-GUIDE.md` for full artist/AI-generation specs.
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

// ---- Helpers ----------------------------------------------------------------

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
 * | Key               | File                          | Footprint |
 * |-------------------|-------------------------------|-----------|
 * | asset_r1          | sprites/bldg_r1.png           | 1x1       |
 * | asset_r2          | sprites/bldg_r2.png           | 1x1       |
 * | asset_r3          | sprites/bldg_r3.png           | 1x1       |
 * | asset_r2_2x2      | sprites/bldg_r2_2x2.png      | 2x2       |
 * | asset_r3_3x3      | sprites/bldg_r3_3x3.png      | 3x3       |
 * | asset_c1          | sprites/bldg_c1.png           | 1x1       |
 * | asset_c2          | sprites/bldg_c2.png           | 1x1       |
 * | asset_c3          | sprites/bldg_c3.png           | 1x1       |
 * | asset_c2_2x2      | sprites/bldg_c2_2x2.png      | 2x2       |
 * | asset_c3_3x3      | sprites/bldg_c3_3x3.png      | 3x3       |
 * | asset_i1          | sprites/bldg_i1.png           | 1x1       |
 * | asset_i2          | sprites/bldg_i2.png           | 1x1       |
 * | asset_i3          | sprites/bldg_i3.png           | 1x1       |
 * | asset_i2_2x2      | sprites/bldg_i2_2x2.png      | 2x2       |
 * | asset_i3_3x3      | sprites/bldg_i3_3x3.png      | 3x3       |
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
