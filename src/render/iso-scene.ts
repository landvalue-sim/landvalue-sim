/**
 * IsoScene — the Phaser render shell.
 *
 * Reads the city `SharedArrayBuffer` view each frame (zero-copy) and paints it
 * as isometric tiles with a back-to-front diagonal sweep: flat ground/water/
 * roads, extruded buildings, and a translucent overlay (land value / pollution
 * / power / water) on top. It also owns the camera and pointer input,
 * translating clicks into sim commands. It writes nothing to the city state —
 * the worker is the only writer.
 */

import Phaser from "phaser";
import type { InteractionStore } from "../app/store.ts";
import type { Command } from "../sim/commands.ts";
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
	type CityState,
	DENSITY_HIGH,
	DENSITY_LOW,
	DENSITY_MED,
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
const COL_RAIL = 0x71717a;
const COL_POWER_LINE = 0xfbbf24;
const COL_R_BUILT = 0x16a34a;
const COL_C_BUILT = 0x2563eb;
const COL_I_BUILT = 0xca8a04;
const COL_R_ZONE = 0x22c55e;
const COL_C_ZONE = 0x3b82f6;
const COL_I_ZONE = 0xeab308;
const COL_DEMOLISH = 0xef4444;
const COL_CURSOR = 0xffffff;
const COL_CIVIC = 0x78350f;
const COL_SOLAR = 0xfde047;
const COL_WATER_PUMP = 0x38bdf8;
const COL_POLICE = 0x1d4ed8;
const COL_FIRE_STN = 0xdc2626;
const COL_HOSPITAL = 0xf472b6;
const COL_SCHOOL = 0xfbbf24;
const COL_COLLEGE = 0x7c3aed;
const COL_LIBRARY = 0xea580c;
const COL_PARK_BLDG = 0x4ade80;
const COL_STADIUM_BLDG = 0x9ca3af;

// Land-value overlay renders value as column height, colored by zoning (or
// road), so you read both what's there and how valuable it is.
const LV_HEIGHT_PER_UNIT = 0.4; // world px per land-value unit
const LV_HEIGHT_CLAMP = 160; // cap so the tallest columns stay readable
const COL_POLLUTION = 0xa832a8;
const COL_POWERED = 0x22c55e;
const COL_UNPOWERED = 0xef4444;
const COL_WATERED = 0x38bdf8;
const COL_UNWATERED = 0xf97316;
const COL_CRIME = 0xef4444;
const COL_TRAFFIC_OV = 0xf97316;
const COL_FIRE_OV = 0xff4500;

// Civic building extrusion heights (tiles tall)
const CIVIC_HEIGHT = 3;

// ---- Terrain extrusion -----------------------------------------------------
// World-pixels of vertical lift per elevation unit (elevation is 0..ELEVATION_MAX).
const ELEV_HEIGHT = 3;
// Water renders as a flat plane at this elevation (≈ WATER_THRESHOLD *
// ELEVATION_MAX), so the sea is level even where the noise floor is uneven.
const SEA_ELEV = 5;
const COL_EARTH = 0x6b4f2a; // dirt sides exposed under raised terrain

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
	// Locked L-shape orientation, set from the initial drag direction; reset to
	// "none" whenever the cursor returns to the origin so it can be re-chosen.
	private dragAxis: "none" | "h" | "v" = "none";

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

		// Civic buildings are single-click only (no drag)
		if (isCivicTool(snap.tool)) {
			this.placeSingle(x, y);
			return;
		}

		if (snap.dragEnabled) {
			// Begin a drag; the preview/commit happens on move/up.
			this.dragging = true;
			this.dragStartX = x;
			this.dragStartY = y;
			this.dragAxis = "none";
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

		if (this.dragging) {
			if (x === this.dragStartX && y === this.dragStartY) {
				// Back at the origin — let the next move re-pick the L direction.
				this.dragAxis = "none";
			} else if (this.dragAxis === "none") {
				const dx = Math.abs(x - this.dragStartX);
				const dy = Math.abs(y - this.dragStartY);
				this.dragAxis = dx >= dy ? "h" : "v";
			}
		}
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

	/** Tiles covered by the active drag: an L-line for roads/rail/power, a rect otherwise. */
	private dragTiles(tool: string): Point[] {
		const ax = this.clampX(this.dragStartX);
		const ay = this.clampY(this.dragStartY);
		const bx = this.clampX(this.hoverX);
		const by = this.clampY(this.hoverY);
		if (isLineTool(tool)) {
			// "v" runs the column first; "h"/"none" run the row first.
			return roadLineTiles(ax, ay, bx, by, this.dragAxis !== "v");
		}
		return rectTiles(ax, ay, bx, by);
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
			const lift = this.groundLift(t.y * this.city.width + t.x);
			g.fillStyle(color, 0.45);
			diamondPath(g, cx, cy, lift);
			g.fillPath();
			g.lineStyle(1, color, 0.9);
			diamondPath(g, cx, cy, lift);
			g.strokePath();
		}
	}

	/** World-space lift of a tile's ground (terrain) surface. */
	private groundLift(idx: number): number {
		const city = this.city;
		const isWater = city.terrain[idx] === TERRAIN_WATER;
		const elev = isWater ? SEA_ELEV : (city.elevation[idx] ?? 0);
		return elev * ELEV_HEIGHT;
	}

	/** World-space height of a tile's top surface in the current overlay mode. */
	private tileTopLift(idx: number, overlay: string): number {
		const city = this.city;
		const ground = this.groundLift(idx);
		const isRoad = city.roads[idx] === 1;
		const isWater = !isRoad && city.terrain[idx] === TERRAIN_WATER;

		if (overlay === "land-value") {
			if (isWater) return ground;
			const lv = city.landValue[idx] ?? 0;
			return ground + Math.min(lv, LV_HEIGHT_CLAMP) * LV_HEIGHT_PER_UNIT;
		}

		if (isRoad || isWater) return ground;
		if (city.rail[idx] === 1 || city.powerLines[idx] === 1) return ground;

		const civicType = city.civic[idx] ?? 0;
		if (civicType !== 0) return ground + CIVIC_HEIGHT * TIER_HEIGHT;

		const tier = city.building[idx] ?? 0;
		return ground + tier * TIER_HEIGHT;
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
		const isRail = !isRoad && !isWater && city.rail[idx] === 1;
		const isPowerLine =
			!isRoad && !isWater && !isRail && city.powerLines[idx] === 1;
		const civicType =
			!isRoad && !isWater && !isRail && !isPowerLine
				? (city.civic[idx] ?? 0)
				: 0;

		let top: number;
		let buildHeight: number; // extrusion above the terrain surface

		if (isRoad) {
			top = COL_ROAD;
			buildHeight = 0;
		} else if (isWater) {
			top = COL_WATER;
			buildHeight = 0;
		} else if (isRail) {
			top = COL_RAIL;
			buildHeight = 0;
		} else if (isPowerLine) {
			top = COL_POWER_LINE;
			buildHeight = 0;
		} else if (civicType !== 0) {
			top = civicColor(civicType);
			buildHeight = CIVIC_HEIGHT * TIER_HEIGHT;
		} else {
			const tier = city.building[idx] ?? 0;
			buildHeight = tier * TIER_HEIGHT;
			top = tier > 0 ? builtColor(city.zoning[idx] ?? 0) : COL_GRASS;
		}

		// Terrain rises from sea level (0) to its elevation; buildings/civics
		// extrude further above that surface.
		const groundLift = this.groundLift(idx);
		const topLift = groundLift + buildHeight;

		if (groundLift > 0) {
			extrudeColumn(g, cx, cy, 0, groundLift, isWater ? COL_WATER : COL_EARTH);
		}
		if (buildHeight > 0) {
			extrudeColumn(g, cx, cy, groundLift, topLift, top);
		}

		// Top diamond.
		g.fillStyle(top, 1);
		diamondPath(g, cx, cy, topLift);
		g.fillPath();

		// Empty zoned land: colored outline so zoning reads before it builds.
		if (
			buildHeight === 0 &&
			!isRoad &&
			!isWater &&
			!isRail &&
			!isPowerLine &&
			civicType === 0
		) {
			const zoneOutline = zoneOutlineColor(city.zoning[idx] ?? 0);
			if (zoneOutline >= 0) {
				g.lineStyle(1.5, zoneOutline, 0.9);
				diamondPath(g, cx, cy, topLift);
				g.strokePath();
			}
		}

		// Fire indicator (always visible regardless of overlay)
		if (city.fire[idx] === 1) {
			g.fillStyle(COL_FIRE_OV, 0.7);
			diamondPath(g, cx, cy, topLift);
			g.fillPath();
		}

		// Overlay tints
		if (overlay === "pollution") {
			const pol = city.pollution[idx] ?? 0;
			if (pol > 0) {
				g.fillStyle(COL_POLLUTION, Math.min(0.6, (pol / 255) * 0.7));
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "power") {
			if (!isWater) {
				const powered = city.power[idx] === 1;
				g.fillStyle(powered ? COL_POWERED : COL_UNPOWERED, 0.45);
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "water") {
			if (!isWater) {
				const watered = city.waterCoverage[idx] === 1;
				g.fillStyle(watered ? COL_WATERED : COL_UNWATERED, 0.45);
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "crime") {
			const cr = city.crime[idx] ?? 0;
			if (cr > 0) {
				g.fillStyle(COL_CRIME, Math.min(0.7, (cr / 255) * 0.8));
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "traffic") {
			const tr = city.traffic[idx] ?? 0;
			if (tr > 0) {
				g.fillStyle(COL_TRAFFIC_OV, Math.min(0.7, (tr / 255) * 0.8));
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "police") {
			if (!isWater) {
				const covered = city.policeCoverage[idx] === 1;
				g.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "fire") {
			if (!isWater) {
				const covered = city.fireCoverage[idx] === 1;
				g.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "education") {
			if (!isWater) {
				const covered = city.educationCoverage[idx] === 1;
				g.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		} else if (overlay === "health") {
			if (!isWater) {
				const covered = city.healthCoverage[idx] === 1;
				g.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				diamondPath(g, cx, cy, topLift);
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
		const ground = this.groundLift(idx);
		if (isWater) {
			if (ground > 0) extrudeColumn(g, cx, cy, 0, ground, COL_WATER);
			g.fillStyle(COL_WATER, 1);
			diamondPath(g, cx, cy, ground);
			g.fillPath();
			return;
		}

		const lv = city.landValue[idx] ?? 0;
		const vh = Math.min(lv, LV_HEIGHT_CLAMP) * LV_HEIGHT_PER_UNIT;
		const col = isRoad ? COL_ROAD : builtColor(city.zoning[idx] ?? 0);

		// Earth column up to terrain height, then the land-value column above it.
		if (ground > 0) extrudeColumn(g, cx, cy, 0, ground, COL_EARTH);
		if (vh > 0) extrudeColumn(g, cx, cy, ground, ground + vh, col);
		g.fillStyle(col, 1);
		diamondPath(g, cx, cy, ground + vh);
		g.fillPath();
	}
}

// ---- Geometry helpers ------------------------------------------------------

/**
 * Draw the two visible side faces of a tile column spanning `baseLift` to
 * `topLift` world-pixels above the tile's flat (lift 0) position. Used for both
 * terrain blocks (0 → ground) and buildings (ground → ground + height).
 */
function extrudeColumn(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	baseLift: number,
	topLift: number,
	top: number,
): void {
	g.fillStyle(shade(top, 0.6), 1);
	quad(
		g,
		cx - HALF_W,
		cy - baseLift,
		cx,
		cy + HALF_H - baseLift,
		cx,
		cy + HALF_H - topLift,
		cx - HALF_W,
		cy - topLift,
	);
	g.fillStyle(shade(top, 0.8), 1);
	quad(
		g,
		cx + HALF_W,
		cy - baseLift,
		cx,
		cy + HALF_H - baseLift,
		cx,
		cy + HALF_H - topLift,
		cx + HALF_W,
		cy - topLift,
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

function civicColor(civicType: number): number {
	if (civicType === CIVIC_COAL_PLANT) return COL_CIVIC;
	if (civicType === CIVIC_SOLAR_PLANT) return COL_SOLAR;
	if (civicType === CIVIC_WATER_PUMP) return COL_WATER_PUMP;
	if (civicType === CIVIC_POLICE) return COL_POLICE;
	if (civicType === CIVIC_FIRE_STATION) return COL_FIRE_STN;
	if (civicType === CIVIC_HOSPITAL) return COL_HOSPITAL;
	if (civicType === CIVIC_SCHOOL) return COL_SCHOOL;
	if (civicType === CIVIC_COLLEGE) return COL_COLLEGE;
	if (civicType === CIVIC_LIBRARY) return COL_LIBRARY;
	if (civicType === CIVIC_PARK) return COL_PARK_BLDG;
	if (civicType === CIVIC_STADIUM) return COL_STADIUM_BLDG;
	return COL_CIVIC;
}

/** Multiply an 0xRRGGBB color's channels by `f` (for shaded side faces). */
function shade(color: number, f: number): number {
	const r = Math.min(255, ((color >> 16) & 0xff) * f) | 0;
	const gch = Math.min(255, ((color >> 8) & 0xff) * f) | 0;
	const b = Math.min(255, (color & 0xff) * f) | 0;
	return (r << 16) | (gch << 8) | b;
}

/** Whether a tool drags as an L-line (like roads) rather than a rectangle. */
function isLineTool(tool: string): boolean {
	return tool === "road" || tool === "rail" || tool === "power-line";
}

/** Whether a tool is a civic building (single-click placement, no drag). */
function isCivicTool(tool: string): boolean {
	return (
		tool === "coal-plant" ||
		tool === "solar-plant" ||
		tool === "water-pump" ||
		tool === "police" ||
		tool === "fire-station" ||
		tool === "hospital" ||
		tool === "school" ||
		tool === "college" ||
		tool === "library" ||
		tool === "park" ||
		tool === "stadium"
	);
}

function previewColor(tool: string): number {
	switch (tool) {
		case "zone-r-low":
		case "zone-r-med":
		case "zone-r-high":
			return COL_R_ZONE;
		case "zone-c-low":
		case "zone-c-med":
		case "zone-c-high":
			return COL_C_ZONE;
		case "zone-i-low":
		case "zone-i-med":
		case "zone-i-high":
			return COL_I_ZONE;
		case "road":
			return COL_ROAD;
		case "rail":
			return COL_RAIL;
		case "power-line":
			return COL_POWER_LINE;
		case "coal-plant":
			return COL_CIVIC;
		case "solar-plant":
			return COL_SOLAR;
		case "water-pump":
			return COL_WATER_PUMP;
		case "police":
			return COL_POLICE;
		case "fire-station":
			return COL_FIRE_STN;
		case "hospital":
			return COL_HOSPITAL;
		case "school":
			return COL_SCHOOL;
		case "college":
			return COL_COLLEGE;
		case "library":
			return COL_LIBRARY;
		case "park":
			return COL_PARK_BLDG;
		case "stadium":
			return COL_STADIUM_BLDG;
		case "demolish":
			return COL_DEMOLISH;
		default:
			return COL_CURSOR;
	}
}

// ---- Command mapping -------------------------------------------------------

function toolToCommand(tool: string, x: number, y: number): Command | null {
	switch (tool) {
		case "zone-r-low":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_RESIDENTIAL,
				density: DENSITY_LOW,
			};
		case "zone-r-med":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_RESIDENTIAL,
				density: DENSITY_MED,
			};
		case "zone-r-high":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_RESIDENTIAL,
				density: DENSITY_HIGH,
			};
		case "zone-c-low":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_COMMERCIAL,
				density: DENSITY_LOW,
			};
		case "zone-c-med":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_COMMERCIAL,
				density: DENSITY_MED,
			};
		case "zone-c-high":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_COMMERCIAL,
				density: DENSITY_HIGH,
			};
		case "zone-i-low":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_INDUSTRIAL,
				density: DENSITY_LOW,
			};
		case "zone-i-med":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_INDUSTRIAL,
				density: DENSITY_MED,
			};
		case "zone-i-high":
			return {
				kind: "zone",
				x,
				y,
				zoneType: ZONE_INDUSTRIAL,
				density: DENSITY_HIGH,
			};
		case "road":
			return { kind: "build-road", x, y };
		case "rail":
			return { kind: "build-rail", x, y };
		case "power-line":
			return { kind: "build-power-line", x, y };
		case "coal-plant":
			return { kind: "place-civic", x, y, civicType: CIVIC_COAL_PLANT };
		case "solar-plant":
			return { kind: "place-civic", x, y, civicType: CIVIC_SOLAR_PLANT };
		case "water-pump":
			return { kind: "place-civic", x, y, civicType: CIVIC_WATER_PUMP };
		case "police":
			return { kind: "place-civic", x, y, civicType: CIVIC_POLICE };
		case "fire-station":
			return { kind: "place-civic", x, y, civicType: CIVIC_FIRE_STATION };
		case "hospital":
			return { kind: "place-civic", x, y, civicType: CIVIC_HOSPITAL };
		case "school":
			return { kind: "place-civic", x, y, civicType: CIVIC_SCHOOL };
		case "college":
			return { kind: "place-civic", x, y, civicType: CIVIC_COLLEGE };
		case "library":
			return { kind: "place-civic", x, y, civicType: CIVIC_LIBRARY };
		case "park":
			return { kind: "place-civic", x, y, civicType: CIVIC_PARK };
		case "stadium":
			return { kind: "place-civic", x, y, civicType: CIVIC_STADIUM };
		case "demolish":
			return { kind: "demolish", x, y };
		default:
			return null;
	}
}
