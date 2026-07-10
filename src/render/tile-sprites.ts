/**
 * Tile sprite system — SC3000-style sprite management for the isometric grid.
 *
 * Supports multi-tile footprints (1x1, 2x2, 3x3) for buildings. Density 1
 * buildings are always 1x1 solo sprites. Density 2 and 3 have both a solo
 * (1x1) fallback and a cluster (2x2 or 3x3) sprite that the renderer uses
 * when adjacent tiles of the same zone and density form a complete block.
 *
 * Placeholder textures are generated procedurally with isometric walls, floor
 * lines, and edge outlines. Replace with real sprite assets by calling
 * `registerBuildingSprite` / `registerClusterSprite` again after loading.
 */

import type Phaser from "phaser";
import { HALF_H, HALF_W } from "./iso.ts";

// ---- Types ------------------------------------------------------------------

/** Defines how a sprite renders on the tile grid. */
export interface TileSpriteEntry {
	/** Phaser texture key. */
	readonly textureKey: string;
	/** Optional frame within a spritesheet / atlas. */
	readonly frame?: string | number;
	/** Footprint width in tiles (x-axis). */
	readonly tileW: number;
	/** Footprint depth in tiles (y-axis). */
	readonly tileH: number;
	/** Pixel offset from computed screen position (fine-tuning). */
	readonly offsetX: number;
	readonly offsetY: number;
	/**
	 * Sprite origin (0-1). The point in the sprite image that aligns with
	 * the footprint's south corner. Default: (0.5, 1.0) = bottom-center.
	 */
	readonly originX: number;
	readonly originY: number;
	/** Display scale (1.0 = native, 0.25 = 4x art scaled to tile). */
	readonly scale: number;
}

// ---- Convenience constructor ------------------------------------------------

/** Create a TileSpriteEntry with sensible defaults. */
export function tileSpriteEntry(
	textureKey: string,
	overrides?: Partial<TileSpriteEntry>,
): TileSpriteEntry {
	return {
		textureKey,
		tileW: 1,
		tileH: 1,
		offsetX: 0,
		offsetY: 0,
		originX: 0.5,
		originY: 1.0,
		scale: 1,
		...overrides,
	};
}

// ---- Registry ---------------------------------------------------------------

/** Solo sprites: one per tile, used for isolated buildings or density 1. */
const BUILDING_SPRITES = new Map<string, TileSpriteEntry>();
/** Cluster sprites: multi-tile, used when adjacent tiles form a matching block. */
const CLUSTER_SPRITES = new Map<string, TileSpriteEntry>();
const CIVIC_SPRITES = new Map<number, TileSpriteEntry>();

/** Register a solo (1x1) building sprite for a zone + density. */
export function registerBuildingSprite(
	zone: "r" | "c" | "i",
	density: 1 | 2 | 3,
	entry: TileSpriteEntry,
): void {
	BUILDING_SPRITES.set(`${zone}${density}`, entry);
}

/** Register a cluster (multi-tile) building sprite for a zone + density. */
export function registerClusterSprite(
	zone: "r" | "c" | "i",
	density: 1 | 2 | 3,
	entry: TileSpriteEntry,
): void {
	CLUSTER_SPRITES.set(`${zone}${density}`, entry);
}

/** Register a civic building sprite by civic type constant. */
export function registerCivicSprite(
	civicType: number,
	entry: TileSpriteEntry,
): void {
	CIVIC_SPRITES.set(civicType, entry);
}

/** Look up the solo sprite for a zoned building (undefined = procedural). */
export function getBuildingSprite(
	zone: number,
	density: number,
): TileSpriteEntry | undefined {
	const z = zone === 1 ? "r" : zone === 2 ? "c" : zone === 3 ? "i" : null;
	if (z === null || density < 1 || density > 3) return undefined;
	return BUILDING_SPRITES.get(`${z}${density}`);
}

/** Look up the cluster sprite for a zoned building (undefined = no cluster). */
export function getClusterSprite(
	zone: number,
	density: number,
): TileSpriteEntry | undefined {
	const z = zone === 1 ? "r" : zone === 2 ? "c" : zone === 3 ? "i" : null;
	if (z === null || density < 1 || density > 3) return undefined;
	return CLUSTER_SPRITES.get(`${z}${density}`);
}

/** Look up the sprite for a civic building (undefined = procedural). */
export function getCivicSprite(civicType: number): TileSpriteEntry | undefined {
	return CIVIC_SPRITES.get(civicType);
}

// ---- Placeholder textures ---------------------------------------------------

/** Procedural textures are rendered at 2x and scaled down for crispness. */
const PROC_RES = 2;
/** Pixels per floor for floor-line spacing (at 1x). */
const FLOOR_H = 7;

/**
 * Generate SC3000-style placeholder building textures and register them.
 * Density 1 gets a 1x1 solo sprite. Density 2/3 get both a 1x1 solo fallback
 * and a 2x2/3x3 cluster sprite.
 */
export function generatePlaceholders(scene: Phaser.Scene): void {
	// Residential (green)
	genSolo(scene, "r", 1, 0x16a34a, 10);
	genSolo(scene, "r", 2, 0x16a34a, 20);
	genSolo(scene, "r", 3, 0x16a34a, 36);
	genCluster(scene, "r", 2, 0x16a34a, 24, 2);
	genCluster(scene, "r", 3, 0x16a34a, 48, 3);

	// Commercial (blue) — tallest at high density
	genSolo(scene, "c", 1, 0x2563eb, 12);
	genSolo(scene, "c", 2, 0x2563eb, 24);
	genSolo(scene, "c", 3, 0x2563eb, 48);
	genCluster(scene, "c", 2, 0x2563eb, 32, 2);
	genCluster(scene, "c", 3, 0x2563eb, 80, 3);

	// Industrial (yellow/brown)
	genSolo(scene, "i", 1, 0xca8a04, 8);
	genSolo(scene, "i", 2, 0xca8a04, 16);
	genSolo(scene, "i", 3, 0xca8a04, 28);
	genCluster(scene, "i", 2, 0xca8a04, 20, 2);
	genCluster(scene, "i", 3, 0xca8a04, 32, 3);
}

function genSolo(
	scene: Phaser.Scene,
	zone: "r" | "c" | "i",
	density: 1 | 2 | 3,
	color: number,
	wallHeight: number,
): void {
	const key = `bldg_${zone}${density}`;
	drawIsoBuilding(scene, key, color, wallHeight * PROC_RES, PROC_RES, PROC_RES);
	registerBuildingSprite(
		zone,
		density,
		tileSpriteEntry(key, { scale: 1 / PROC_RES }),
	);
}

function genCluster(
	scene: Phaser.Scene,
	zone: "r" | "c" | "i",
	density: 1 | 2 | 3,
	color: number,
	wallHeight: number,
	footprint: number,
): void {
	const key = `bldg_${zone}${density}_${footprint}x${footprint}`;
	drawIsoBuilding(
		scene,
		key,
		color,
		wallHeight * PROC_RES,
		footprint * PROC_RES,
		footprint * PROC_RES,
	);
	registerClusterSprite(
		zone,
		density,
		tileSpriteEntry(key, {
			tileW: footprint,
			tileH: footprint,
			scale: 1 / PROC_RES,
		}),
	);
}

// ---- Isometric building renderer --------------------------------------------

/**
 * Draw an isometric building placeholder and register it as a Phaser texture.
 *
 * The sprite is `(tileW + tileH) * HALF_W` wide and
 * `(tileW + tileH) * HALF_H + wallHeight` tall. Origin is bottom-center
 * (0.5, 1.0), aligning the footprint's south corner with the placement point.
 *
 * Diamond geometry for a tileW x tileH footprint:
 *   Roof N = (mid, 0)
 *   Roof E = (spriteW, baseH/2)
 *   Roof S = (mid, baseH)
 *   Roof W = (0, baseH/2)
 *   Base S = (mid, spriteH)   (= sprite bottom-center)
 */
function drawIsoBuilding(
	scene: Phaser.Scene,
	key: string,
	color: number,
	wallHeight: number,
	tileW: number,
	tileH: number,
): void {
	const spriteW = (tileW + tileH) * HALF_W;
	const baseH = (tileW + tileH) * HALF_H;
	const spriteH = baseH + wallHeight;
	const mid = spriteW / 2;

	const g = scene.add.graphics();

	// Left wall face (W-S base to W-S roof)
	g.fillStyle(shadeColor(color, 0.6), 1);
	fillQuad(g, 0, spriteH - baseH / 2, mid, spriteH, mid, baseH, 0, baseH / 2);

	// Right wall face (S-E base to S-E roof)
	g.fillStyle(shadeColor(color, 0.8), 1);
	fillQuad(
		g,
		mid,
		spriteH,
		spriteW,
		spriteH - baseH / 2,
		spriteW,
		baseH / 2,
		mid,
		baseH,
	);

	// Floor lines across both wall faces
	const numFloors = Math.floor(wallHeight / FLOOR_H);
	if (numFloors > 0) {
		const lineColor = shadeColor(color, 0.35);
		g.lineStyle(1, lineColor, 0.6);
		for (let f = 1; f <= numFloors; f++) {
			const h = f * FLOOR_H;
			const yCenter = spriteH - h;
			const yEdge = spriteH - baseH / 2 - h;
			// Left wall
			g.beginPath();
			g.moveTo(0, yEdge);
			g.lineTo(mid, yCenter);
			g.strokePath();
			// Right wall
			g.beginPath();
			g.moveTo(mid, yCenter);
			g.lineTo(spriteW, yEdge);
			g.strokePath();
		}
	}

	// Window dots — small bright rectangles on each floor
	const windowShade = shadeColor(color, 1.4);
	const wSize = spriteW >= 64 ? 3 : 2;
	const wMargin = wSize + 1;
	const numWindowCols = Math.max(
		1,
		Math.floor((mid - wMargin * 2) / (wSize + 2)),
	);
	if (numFloors > 0 && numWindowCols > 0) {
		g.fillStyle(windowShade, 0.5);
		const colSpacing = (mid - wMargin * 2) / numWindowCols;
		const slant = baseH / 2 / mid;
		for (let f = 0; f < numFloors; f++) {
			const floorMidH = (f + 0.5) * FLOOR_H;
			const yBase = spriteH - floorMidH;
			for (let c = 0; c < numWindowCols; c++) {
				const wx = wMargin + c * colSpacing + colSpacing / 2 - wSize / 2;
				// Left wall: y shifts up as x increases (isometric slant)
				const lyShift = wx * slant;
				g.fillRect(wx, yBase - lyShift - wSize / 2, wSize, wSize);
				// Right wall: mirror across center
				const rwx = mid + wMargin + c * colSpacing + colSpacing / 2 - wSize / 2;
				const ryShift = (spriteW - rwx) * slant;
				g.fillRect(rwx, yBase - ryShift - wSize / 2, wSize, wSize);
			}
		}
	}

	// Roof diamond
	g.fillStyle(shadeColor(color, 1.05), 1);
	fillQuad(g, mid, 0, spriteW, baseH / 2, mid, baseH, 0, baseH / 2);

	// Edge outlines
	const outlineColor = shadeColor(color, 0.4);
	g.lineStyle(1, outlineColor, 0.8);
	// Roof outline
	strokeQuad(g, mid, 0, spriteW, baseH / 2, mid, baseH, 0, baseH / 2);
	// Building vertical + bottom edges
	g.beginPath();
	g.moveTo(0, baseH / 2);
	g.lineTo(0, spriteH - baseH / 2);
	g.lineTo(mid, spriteH);
	g.lineTo(spriteW, spriteH - baseH / 2);
	g.lineTo(spriteW, baseH / 2);
	g.strokePath();
	// Front vertical edge
	g.beginPath();
	g.moveTo(mid, baseH);
	g.lineTo(mid, spriteH);
	g.strokePath();

	g.generateTexture(key, spriteW, spriteH);
	g.destroy();
}

// ---- Drawing helpers --------------------------------------------------------

function fillQuad(
	g: Phaser.GameObjects.Graphics,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	x3: number,
	y3: number,
	x4: number,
	y4: number,
): void {
	g.beginPath();
	g.moveTo(x1, y1);
	g.lineTo(x2, y2);
	g.lineTo(x3, y3);
	g.lineTo(x4, y4);
	g.closePath();
	g.fillPath();
}

function strokeQuad(
	g: Phaser.GameObjects.Graphics,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	x3: number,
	y3: number,
	x4: number,
	y4: number,
): void {
	g.beginPath();
	g.moveTo(x1, y1);
	g.lineTo(x2, y2);
	g.lineTo(x3, y3);
	g.lineTo(x4, y4);
	g.closePath();
	g.strokePath();
}

/** Multiply an 0xRRGGBB color's channels by factor f. */
function shadeColor(color: number, f: number): number {
	const r = Math.min(255, ((color >> 16) & 0xff) * f) | 0;
	const gc = Math.min(255, ((color >> 8) & 0xff) * f) | 0;
	const b = Math.min(255, (color & 0xff) * f) | 0;
	return (r << 16) | (gc << 8) | b;
}
