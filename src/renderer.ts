/**
 * Canvas grid renderer — draws the city state as a top-down colored grid.
 *
 * Supports pan/zoom camera, overlay modes (land value heatmap, pollution),
 * and cursor highlight.
 */

import type { CityState } from "./sim/city-state.ts";
import {
	BUILDING_EMPTY,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "./sim/constants.ts";
import type { AppState, Tool } from "./types.ts";

// ---- Tile colors -----------------------------------------------------------

const COL_GRASS = "#3d6b24";
const COL_WATER = "#2563eb";
const COL_ROAD = "#52525b";

const COL_R_BUILT = "#16a34a";
const COL_C_BUILT = "#2563eb";
const COL_I_BUILT = "#ca8a04";

const COL_R_ZONE = "#22c55e";
const COL_C_ZONE = "#3b82f6";
const COL_I_ZONE = "#eab308";

// Pre-computed color LUTs to avoid per-tile string allocation each frame.
// Land value: 256 entries mapping value (0-255) to an hsla() color string.
const LV_LUT_SIZE = 256;
const LV_LUT_MAX = 150;
const LV_LUT: string[] = new Array(LV_LUT_SIZE);
for (let i = 0; i < LV_LUT_SIZE; i++) {
	const t = Math.min(1, i / LV_LUT_MAX);
	const hue = 120 * (1 - t);
	LV_LUT[i] = `hsla(${hue.toFixed(0)},80%,45%,0.45)`;
}

// Pollution: 256 entries mapping pollution level (0-255) to an rgba() color string.
const POL_LUT: string[] = new Array(LV_LUT_SIZE);
for (let i = 0; i < LV_LUT_SIZE; i++) {
	const alpha = Math.min(0.6, (i / 255) * 0.7);
	POL_LUT[i] = `rgba(168,50,168,${alpha.toFixed(2)})`;
}

const COL_CURSOR_TOOL: Record<Tool, string> = {
	none: "rgba(255,255,255,0.25)",
	"zone-r": "rgba(34,197,94,0.35)",
	"zone-c": "rgba(59,130,246,0.35)",
	"zone-i": "rgba(234,179,8,0.35)",
	road: "rgba(107,114,128,0.35)",
	demolish: "rgba(239,68,68,0.35)",
};

// ---- Public API ------------------------------------------------------------

export function render(
	ctx: CanvasRenderingContext2D,
	canvasW: number,
	canvasH: number,
	city: CityState,
	app: AppState,
): void {
	const { camera } = app;
	const ts = camera.tileSize;

	ctx.clearRect(0, 0, canvasW, canvasH);

	// Visible tile range (clamp to grid bounds)
	const x0 = Math.max(0, Math.floor(camera.offsetX / ts));
	const y0 = Math.max(0, Math.floor(camera.offsetY / ts));
	const x1 = Math.min(city.width, Math.ceil((camera.offsetX + canvasW) / ts));
	const y1 = Math.min(city.height, Math.ceil((camera.offsetY + canvasH) / ts));

	// Draw tiles
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const idx = y * city.width + x;
			const sx = x * ts - camera.offsetX;
			const sy = y * ts - camera.offsetY;

			// Base tile
			ctx.fillStyle = tileColor(city, idx);
			ctx.fillRect(sx, sy, ts, ts);

			// Zone border on empty zones
			const zone = city.zoning[idx];
			if (
				zone !== undefined &&
				zone !== ZONE_NONE &&
				city.building[idx] === BUILDING_EMPTY &&
				city.roads[idx] !== 1
			) {
				const border = zoneBorderColor(zone);
				if (border !== null) {
					ctx.strokeStyle = border;
					ctx.lineWidth = 1;
					ctx.strokeRect(sx + 0.5, sy + 0.5, ts - 1, ts - 1);
				}
			}
		}
	}

	// Overlay pass
	if (app.overlay !== "none") {
		drawOverlay(ctx, city, app, x0, y0, x1, y1);
	}

	// Grid lines at higher zoom
	if (ts >= 16) {
		ctx.strokeStyle = "rgba(255,255,255,0.06)";
		ctx.lineWidth = 0.5;
		for (let y = y0; y <= y1; y++) {
			const sy = y * ts - camera.offsetY;
			ctx.beginPath();
			ctx.moveTo(x0 * ts - camera.offsetX, sy);
			ctx.lineTo(x1 * ts - camera.offsetX, sy);
			ctx.stroke();
		}
		for (let x = x0; x <= x1; x++) {
			const sx = x * ts - camera.offsetX;
			ctx.beginPath();
			ctx.moveTo(sx, y0 * ts - camera.offsetY);
			ctx.lineTo(sx, y1 * ts - camera.offsetY);
			ctx.stroke();
		}
	}

	// Cursor highlight
	if (app.cursorTile !== null) {
		const { x, y } = app.cursorTile;
		if (x >= 0 && x < city.width && y >= 0 && y < city.height) {
			const sx = x * ts - camera.offsetX;
			const sy = y * ts - camera.offsetY;
			ctx.fillStyle = COL_CURSOR_TOOL[app.tool];
			ctx.fillRect(sx, sy, ts, ts);
			ctx.strokeStyle = "rgba(255,255,255,0.5)";
			ctx.lineWidth = 1.5;
			ctx.strokeRect(sx, sy, ts, ts);
		}
	}
}

export function screenToTile(
	screenX: number,
	screenY: number,
	offsetX: number,
	offsetY: number,
	tileSize: number,
): { x: number; y: number } {
	return {
		x: Math.floor((screenX + offsetX) / tileSize),
		y: Math.floor((screenY + offsetY) / tileSize),
	};
}

// ---- Internals -------------------------------------------------------------

function tileColor(city: CityState, idx: number): string {
	if (city.roads[idx] === 1) return COL_ROAD;
	if (city.terrain[idx] === TERRAIN_WATER) return COL_WATER;
	if (city.building[idx] !== BUILDING_EMPTY) {
		const zone = city.zoning[idx];
		if (zone === ZONE_RESIDENTIAL) return COL_R_BUILT;
		if (zone === ZONE_COMMERCIAL) return COL_C_BUILT;
		if (zone === ZONE_INDUSTRIAL) return COL_I_BUILT;
	}
	return COL_GRASS;
}

function zoneBorderColor(zone: number): string | null {
	if (zone === ZONE_RESIDENTIAL) return COL_R_ZONE;
	if (zone === ZONE_COMMERCIAL) return COL_C_ZONE;
	if (zone === ZONE_INDUSTRIAL) return COL_I_ZONE;
	return null;
}

function drawOverlay(
	ctx: CanvasRenderingContext2D,
	city: CityState,
	app: AppState,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): void {
	const ts = app.camera.tileSize;

	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const idx = y * city.width + x;
			const sx = x * ts - app.camera.offsetX;
			const sy = y * ts - app.camera.offsetY;

			if (app.overlay === "land-value") {
				const lv = city.landValue[idx] ?? 0;
				if (lv > 0) {
					const clamped = Math.min(lv, LV_LUT_SIZE - 1);
					ctx.fillStyle = LV_LUT[clamped] ?? LV_LUT[0] ?? "";
					ctx.fillRect(sx, sy, ts, ts);
				}
			} else if (app.overlay === "pollution") {
				const pol = city.pollution[idx] ?? 0;
				if (pol > 0) {
					ctx.fillStyle = POL_LUT[pol] ?? POL_LUT[0] ?? "";
					ctx.fillRect(sx, sy, ts, ts);
				}
			}
		}
	}
}
