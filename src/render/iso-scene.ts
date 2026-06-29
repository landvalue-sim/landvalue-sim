/**
 * IsoScene — the Phaser render shell.
 *
 * Reads the city `SharedArrayBuffer` view each frame (zero-copy) and paints it
 * as isometric tiles with a back-to-front diagonal sweep: flat ground/water/
 * roads, extruded buildings, and a translucent overlay (land value / pollution)
 * on top. It also owns the camera and pointer input, translating clicks into
 * sim commands. It writes nothing to the city state — the worker is the only
 * writer.
 */

import Phaser from "phaser";
import type { InteractionStore } from "../app/store.ts";
import type { Command } from "../sim/commands.ts";
import {
	type CityState,
	TERRAIN_WATER,
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_NONE,
	ZONE_RESIDENTIAL,
} from "../sim/index.ts";
import { type Point, rectTiles, roadLineTiles } from "./drag.ts";
import { HALF_H, HALF_W, screenToGrid, TIER_HEIGHT } from "./iso.ts";

// ---- Palette (0xRRGGBB) ----------------------------------------------------

const COL_GRASS = 0x3d6b24;
const COL_WATER = 0x2563eb;
const COL_ROAD = 0x52525b;
const COL_R_BUILT = 0x16a34a;
const COL_C_BUILT = 0x2563eb;
const COL_I_BUILT = 0xca8a04;
const COL_R_ZONE = 0x22c55e;
const COL_C_ZONE = 0x3b82f6;
const COL_I_ZONE = 0xeab308;
const COL_DEMOLISH = 0xef4444;
const COL_CURSOR = 0xffffff;

// Land-value overlay renders value as column height, colored by zoning (or
// road), so you read both what's there and how valuable it is.
const LV_HEIGHT_PER_UNIT = 0.4; // world px per land-value unit
const LV_HEIGHT_CLAMP = 160; // cap so the tallest columns stay readable
const COL_POLLUTION = 0xa832a8;

// ---- Camera tuning ---------------------------------------------------------

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.15;
const KEY_PAN_SPEED = 600; // world px / second

export interface SceneDeps {
	readonly city: CityState;
	readonly store: InteractionStore;
	readonly sendCommands: (cmds: ReadonlyArray<Command>) => void;
}

export class IsoScene extends Phaser.Scene {
	private readonly city: CityState;
	private readonly store: InteractionStore;
	private readonly sendCommands: (cmds: ReadonlyArray<Command>) => void;

	private g!: Phaser.GameObjects.Graphics;
	private keys!: {
		up: Phaser.Input.Keyboard.Key;
		down: Phaser.Input.Keyboard.Key;
		left: Phaser.Input.Keyboard.Key;
		right: Phaser.Input.Keyboard.Key;
		w: Phaser.Input.Keyboard.Key;
		a: Phaser.Input.Keyboard.Key;
		s: Phaser.Input.Keyboard.Key;
		d: Phaser.Input.Keyboard.Key;
	};

	private hoverX = -1; // current tile under the pointer (also the drag end)
	private hoverY = -1;
	private panning = false;
	private dragging = false;
	private dragStartX = -1;
	private dragStartY = -1;

	constructor(deps: SceneDeps) {
		super({ key: "iso" });
		this.city = deps.city;
		this.store = deps.store;
		this.sendCommands = deps.sendCommands;
	}

	create(): void {
		this.g = this.add.graphics();

		const cam = this.cameras.main;
		cam.setBackgroundColor(0x0f172a);
		// Center on the middle of the grid in world space.
		const midX = (this.city.width / 2 - this.city.height / 2) * HALF_W;
		const midY = (this.city.width / 2 + this.city.height / 2) * HALF_H;
		cam.centerOn(midX, midY);
		cam.setZoom(1.4);

		const kb = this.input.keyboard;
		if (kb !== null) {
			this.keys = {
				up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
				down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
				left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
				right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
				w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
				a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
				s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
				d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
			};
		}

		this.input.mouse?.disableContextMenu();
		this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
		this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
		this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
		this.input.on(
			Phaser.Input.Events.POINTER_UP_OUTSIDE,
			this.onPointerUp,
			this,
		);
		this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
	}

	update(_time: number, delta: number): void {
		this.panKeys(delta);
		this.draw();
	}

	// ---- Input ---------------------------------------------------------------

	private onPointerDown(pointer: Phaser.Input.Pointer): void {
		if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
			this.panning = true;
			return;
		}
		const snap = this.store.getSnapshot();
		if (snap.tool === "none") return;

		const { x, y } = this.pointerTile(pointer);
		this.hoverX = x;
		this.hoverY = y;

		if (snap.dragEnabled) {
			// Begin a drag; the preview/commit happens on move/up.
			this.dragging = true;
			this.dragStartX = x;
			this.dragStartY = y;
		} else {
			this.placeSingle(x, y);
		}
	}

	private onPointerMove(pointer: Phaser.Input.Pointer): void {
		if (this.panning) {
			const cam = this.cameras.main;
			cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
			cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
			return;
		}
		const { x, y } = this.pointerTile(pointer);
		this.hoverX = x;
		this.hoverY = y;
	}

	private onPointerUp(): void {
		if (this.dragging) {
			this.commitDrag();
			this.dragging = false;
		}
		this.panning = false;
	}

	private onWheel(
		pointer: Phaser.Input.Pointer,
		_over: unknown,
		_dx: number,
		dy: number,
	): void {
		const cam = this.cameras.main;
		const z0 = cam.zoom;
		const factor = dy < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const z1 = Phaser.Math.Clamp(z0 * factor, MIN_ZOOM, MAX_ZOOM);
		if (z1 === z0) return;

		// Phaser zooms about the camera center, so screen->world is
		//   world = scroll + center + (screen - center) / zoom.
		// To keep the world point under the cursor fixed across the zoom change,
		// shift scroll by the cursor's offset from center times the change in
		// inverse zoom.
		const dInv = 1 / z0 - 1 / z1;
		cam.setZoom(z1);
		cam.scrollX += (pointer.x - cam.centerX) * dInv;
		cam.scrollY += (pointer.y - cam.centerY) * dInv;
	}

	private panKeys(delta: number): void {
		if (this.keys === undefined) return;
		const cam = this.cameras.main;
		const step = (KEY_PAN_SPEED * delta) / 1000 / cam.zoom;
		if (this.keys.left.isDown || this.keys.a.isDown) cam.scrollX -= step;
		if (this.keys.right.isDown || this.keys.d.isDown) cam.scrollX += step;
		if (this.keys.up.isDown || this.keys.w.isDown) cam.scrollY -= step;
		if (this.keys.down.isDown || this.keys.s.isDown) cam.scrollY += step;
	}

	private pointerTile(pointer: Phaser.Input.Pointer): { x: number; y: number } {
		const g = screenToGrid(pointer.worldX, pointer.worldY);
		return { x: Math.floor(g.x), y: Math.floor(g.y) };
	}

	private placeSingle(x: number, y: number): void {
		if (!this.inBounds(x, y)) return;
		const cmd = toolToCommand(this.store.getSnapshot().tool, x, y);
		if (cmd !== null) this.sendCommands([cmd]);
	}

	/** Commit the current drag as one batch of commands (line or rectangle). */
	private commitDrag(): void {
		const tool = this.store.getSnapshot().tool;
		if (tool === "none") return;

		const cmds: Command[] = [];
		for (const t of this.dragTiles(tool)) {
			if (!this.inBounds(t.x, t.y)) continue;
			const cmd = toolToCommand(tool, t.x, t.y);
			if (cmd !== null) cmds.push(cmd);
		}
		if (cmds.length > 0) this.sendCommands(cmds);
	}

	/** Tiles covered by the active drag: an L-line for roads, a rect otherwise. */
	private dragTiles(tool: string): Point[] {
		const ax = this.clampX(this.dragStartX);
		const ay = this.clampY(this.dragStartY);
		const bx = this.clampX(this.hoverX);
		const by = this.clampY(this.hoverY);
		return tool === "road"
			? roadLineTiles(ax, ay, bx, by)
			: rectTiles(ax, ay, bx, by);
	}

	private inBounds(x: number, y: number): boolean {
		return x >= 0 && x < this.city.width && y >= 0 && y < this.city.height;
	}

	private clampX(x: number): number {
		return Math.max(0, Math.min(this.city.width - 1, x));
	}

	private clampY(y: number): number {
		return Math.max(0, Math.min(this.city.height - 1, y));
	}

	// ---- Drawing -------------------------------------------------------------

	private draw(): void {
		const g = this.g;
		const city = this.city;
		const w = city.width;
		const h = city.height;
		const overlay = this.store.getSnapshot().overlay;

		g.clear();

		// Back-to-front diagonal sweep so extruded buildings occlude correctly.
		const maxD = w - 1 + (h - 1);
		for (let d = 0; d <= maxD; d++) {
			const xStart = Math.max(0, d - (h - 1));
			const xEnd = Math.min(w - 1, d);
			for (let x = xStart; x <= xEnd; x++) {
				const y = d - x;
				this.drawTile(x, y, overlay);
			}
		}

		// While dragging, preview the affected footprint; otherwise highlight the
		// single hovered tile.
		if (this.dragging) {
			this.drawDragPreview();
		} else if (
			this.hoverX >= 0 &&
			this.hoverX < w &&
			this.hoverY >= 0 &&
			this.hoverY < h
		) {
			const idx = this.hoverY * w + this.hoverX;
			const cx = (this.hoverX - this.hoverY) * HALF_W;
			const cy = (this.hoverX + this.hoverY) * HALF_H;
			g.lineStyle(2, COL_CURSOR, 0.9);
			diamondPath(g, cx, cy, this.tileTopLift(idx, overlay));
			g.strokePath();
		}
	}

	/** Draw a translucent footprint of the tiles the current drag would place. */
	private drawDragPreview(): void {
		const tool = this.store.getSnapshot().tool;
		if (tool === "none") return;

		const g = this.g;
		const color = previewColor(tool);
		for (const t of this.dragTiles(tool)) {
			if (!this.inBounds(t.x, t.y)) continue;
			const cx = (t.x - t.y) * HALF_W;
			const cy = (t.x + t.y) * HALF_H;
			g.fillStyle(color, 0.45);
			diamondPath(g, cx, cy, 0);
			g.fillPath();
			g.lineStyle(1, color, 0.9);
			diamondPath(g, cx, cy, 0);
			g.strokePath();
		}
	}

	/** World-space height of a tile's top surface in the current overlay mode. */
	private tileTopLift(idx: number, overlay: string): number {
		const city = this.city;
		const isRoad = city.roads[idx] === 1;
		const isWater = !isRoad && city.terrain[idx] === TERRAIN_WATER;

		if (overlay === "land-value") {
			if (isWater) return 0;
			const lv = city.landValue[idx] ?? 0;
			return Math.min(lv, LV_HEIGHT_CLAMP) * LV_HEIGHT_PER_UNIT;
		}

		const tier = isRoad || isWater ? 0 : (city.building[idx] ?? 0);
		return tier * TIER_HEIGHT;
	}

	private drawTile(x: number, y: number, overlay: string): void {
		// Land value gets its own representation: buildings are hidden and each
		// tile is extruded by its land value instead.
		if (overlay === "land-value") {
			this.drawLandValueTile(x, y);
			return;
		}

		const g = this.g;
		const city = this.city;
		const idx = y * city.width + x;
		const cx = (x - y) * HALF_W;
		const cy = (x + y) * HALF_H;

		const isRoad = city.roads[idx] === 1;
		const isWater = !isRoad && city.terrain[idx] === TERRAIN_WATER;
		const tier = isRoad || isWater ? 0 : (city.building[idx] ?? 0);
		const height = tier * TIER_HEIGHT;

		// Base / top surface color.
		let top: number;
		if (isRoad) top = COL_ROAD;
		else if (isWater) top = COL_WATER;
		else if (tier > 0) top = builtColor(city.zoning[idx] ?? 0);
		else top = COL_GRASS;

		if (height > 0) extrudeFaces(g, cx, cy, height, top);

		// Top diamond.
		g.fillStyle(top, 1);
		diamondPath(g, cx, cy, height);
		g.fillPath();

		// Empty zoned land: colored outline so zoning reads before it builds.
		if (tier === 0 && !isRoad && !isWater) {
			const zoneOutline = zoneOutlineColor(city.zoning[idx] ?? 0);
			if (zoneOutline >= 0) {
				g.lineStyle(1.5, zoneOutline, 0.9);
				diamondPath(g, cx, cy, 0);
				g.strokePath();
			}
		}

		// Pollution tint on the top surface.
		if (overlay === "pollution") {
			const pol = city.pollution[idx] ?? 0;
			if (pol > 0) {
				g.fillStyle(COL_POLLUTION, Math.min(0.6, (pol / 255) * 0.7));
				diamondPath(g, cx, cy, height);
				g.fillPath();
			}
		}
	}

	/**
	 * Land-value view: each tile is a solid column whose height encodes its land
	 * value, colored by what occupies the plot — zoning (R/C/I), road, or bare
	 * land. Water stays flat for orientation.
	 */
	private drawLandValueTile(x: number, y: number): void {
		const g = this.g;
		const city = this.city;
		const idx = y * city.width + x;
		const cx = (x - y) * HALF_W;
		const cy = (x + y) * HALF_H;

		const isRoad = city.roads[idx] === 1;
		const isWater = !isRoad && city.terrain[idx] === TERRAIN_WATER;
		if (isWater) {
			g.fillStyle(COL_WATER, 1);
			diamondPath(g, cx, cy, 0);
			g.fillPath();
			return;
		}

		const lv = city.landValue[idx] ?? 0;
		const vh = Math.min(lv, LV_HEIGHT_CLAMP) * LV_HEIGHT_PER_UNIT;
		const col = isRoad ? COL_ROAD : builtColor(city.zoning[idx] ?? 0);

		if (vh > 0) extrudeFaces(g, cx, cy, vh, col);
		g.fillStyle(col, 1);
		diamondPath(g, cx, cy, vh);
		g.fillPath();
	}
}

// ---- Geometry helpers ------------------------------------------------------

/** Draw the two visible side faces of a tile column `height` px tall. */
function extrudeFaces(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	height: number,
	top: number,
): void {
	g.fillStyle(shade(top, 0.6), 1);
	quad(
		g,
		cx - HALF_W,
		cy,
		cx,
		cy + HALF_H,
		cx,
		cy + HALF_H - height,
		cx - HALF_W,
		cy - height,
	);
	g.fillStyle(shade(top, 0.8), 1);
	quad(
		g,
		cx + HALF_W,
		cy,
		cx,
		cy + HALF_H,
		cx,
		cy + HALF_H - height,
		cx + HALF_W,
		cy - height,
	);
}

function diamondPath(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	lift: number,
): void {
	const yc = cy - lift;
	g.beginPath();
	g.moveTo(cx, yc - HALF_H);
	g.lineTo(cx + HALF_W, yc);
	g.lineTo(cx, yc + HALF_H);
	g.lineTo(cx - HALF_W, yc);
	g.closePath();
}

function quad(
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

// ---- Color helpers ---------------------------------------------------------

function builtColor(zone: number): number {
	if (zone === ZONE_RESIDENTIAL) return COL_R_BUILT;
	if (zone === ZONE_COMMERCIAL) return COL_C_BUILT;
	if (zone === ZONE_INDUSTRIAL) return COL_I_BUILT;
	return COL_GRASS;
}

function zoneOutlineColor(zone: number): number {
	if (zone === ZONE_RESIDENTIAL) return COL_R_ZONE;
	if (zone === ZONE_COMMERCIAL) return COL_C_ZONE;
	if (zone === ZONE_INDUSTRIAL) return COL_I_ZONE;
	if (zone === ZONE_NONE) return -1;
	return -1;
}

/** Multiply an 0xRRGGBB color's channels by `f` (for shaded side faces). */
function shade(color: number, f: number): number {
	const r = Math.min(255, ((color >> 16) & 0xff) * f) | 0;
	const gch = Math.min(255, ((color >> 8) & 0xff) * f) | 0;
	const b = Math.min(255, (color & 0xff) * f) | 0;
	return (r << 16) | (gch << 8) | b;
}

function previewColor(tool: string): number {
	switch (tool) {
		case "zone-r":
			return COL_R_ZONE;
		case "zone-c":
			return COL_C_ZONE;
		case "zone-i":
			return COL_I_ZONE;
		case "road":
			return COL_ROAD;
		case "demolish":
			return COL_DEMOLISH;
		default:
			return COL_CURSOR;
	}
}

// ---- Command mapping -------------------------------------------------------

function toolToCommand(tool: string, x: number, y: number): Command | null {
	switch (tool) {
		case "zone-r":
			return { kind: "zone", x, y, zoneType: ZONE_RESIDENTIAL };
		case "zone-c":
			return { kind: "zone", x, y, zoneType: ZONE_COMMERCIAL };
		case "zone-i":
			return { kind: "zone", x, y, zoneType: ZONE_INDUSTRIAL };
		case "road":
			return { kind: "build-road", x, y };
		case "demolish":
			return { kind: "demolish", x, y };
		default:
			return null;
	}
}
