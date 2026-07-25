/**
 * IsoScene — the Phaser render shell.
 *
 * Reads the city `SharedArrayBuffer` view each frame (zero-copy) and paints it
 * as isometric tiles with a back-to-front diagonal sweep: RCT-style sloped
 * terrain from per-corner heights, flat water planes, extruded buildings, and
 * a translucent overlay (land value / pollution / power / water) on top. It
 * also owns the camera and pointer input, translating clicks into sim
 * commands (including corner-precision terraforming). It writes nothing to
 * the city state — the worker is the only writer.
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
	CORNER_ALL,
	CORNER_E,
	CORNER_N,
	CORNER_S,
	CORNER_W,
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
import { ELEV_HEIGHT, HALF_H, HALF_W, TIER_HEIGHT } from "./iso.ts";
import { pickTile, tileSurfaceHeight } from "./picking.ts";
import { CIVIC_MANIFEST, SPRITE_MANIFEST } from "./sprite-manifest.ts";
import { SpritePool } from "./sprite-pool.ts";
import {
	generatePlaceholders,
	getBuildingSprite,
	getCivicSprite,
	getClusterSprite,
	registerBuildingSprite,
	registerCivicSprite,
	registerClusterSprite,
	type TileSpriteEntry,
	tileSpriteEntry,
} from "./tile-sprites.ts";

// ---- Palette (0xRRGGBB) ----------------------------------------------------

const COL_GRASS = 0x3d6b24;
const COL_WATER = 0x2563eb;
const COL_ROAD = 0x52525b;
const COL_RAIL = 0x71717a;
const COL_POWER_LINE = 0xfbbf24;
const COL_WATER_PIPE = 0x06b6d4;
const COL_PIPE_DISCONNECTED = 0xf97316; // orange — pipe not reached by water network
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
// Tiles are RCT-style: each of the four diamond corners has its own height
// from `city.vertexHeights` (lifted ELEV_HEIGHT world-px per unit), so tile
// tops render as sloped faces. Water tiles render as a flat plane at their
// per-tile `waterLevel`.
const COL_EARTH = 0x6b4f2a; // dirt sides exposed under raised terrain
// Directional shading strength for sloped grass (per unit of corner tilt).
const SLOPE_SHADE = 0.07;

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
	private gOverlay!: Phaser.GameObjects.Graphics;
	private sprites!: SpritePool;
	/** Per-frame scratch: tiles covered by a multi-tile cluster sprite. */
	private covered!: Uint8Array;
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
	// Fractional position within the hovered tile (0..1), for corner-precision
	// terraforming: near a corner edits that corner, near the center the tile.
	private hoverFx = 0.5;
	private hoverFy = 0.5;
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

	preload(): void {
		// Attempt to load every sprite in the manifest. Missing files are
		// silently ignored — the procedural placeholder remains in use.
		for (const entry of SPRITE_MANIFEST) {
			this.load.image(entry.key, entry.path);
		}
		for (const entry of CIVIC_MANIFEST) {
			this.load.image(entry.key, entry.path);
		}
		this.load.on("loaderror", (file: Phaser.Loader.File) => {
			// Expected when an artist hasn't produced the asset yet. Warn in dev
			// so missing assets are visible; the procedural placeholder stays in
			// use. Vite strips this branch from production builds.
			if (import.meta.env.DEV) {
				console.warn(`sprite asset missing: ${file.key} (${file.src})`);
			}
			this.textures.remove(file.key);
		});
	}

	create(): void {
		this.g = this.add.graphics();
		this.g.setDepth(-1);
		this.gOverlay = this.add.graphics();
		this.gOverlay.setDepth(10000);

		// Sprite system: blank texture for pool, placeholder buildings.
		const blankG = this.add.graphics();
		blankG.generateTexture("_blank", 1, 1);
		blankG.destroy();
		generatePlaceholders(this);

		// Override placeholders with any real assets that loaded successfully.
		// Scale is computed from the texture's actual width so any resolution
		// image (e.g. Nano Banana 2 output) fits the tile footprint.
		for (const m of SPRITE_MANIFEST) {
			if (!this.textures.exists(m.key)) continue;
			const tex = this.textures.get(m.key);
			const src = tex.getSourceImage();
			const footprintPx = (m.tileW + m.tileH) * HALF_W;
			const autoScale = footprintPx / src.width;
			const entry = tileSpriteEntry(m.key, {
				tileW: m.tileW,
				tileH: m.tileH,
				originX: m.originX,
				originY: m.originY,
				scale: autoScale,
			});
			if (m.cluster) {
				registerClusterSprite(m.zone, m.density, entry);
			} else {
				registerBuildingSprite(m.zone, m.density, entry);
			}
		}

		// Register loaded civic sprites.
		for (const cm of CIVIC_MANIFEST) {
			if (!this.textures.exists(cm.key)) continue;
			const tex = this.textures.get(cm.key);
			const src = tex.getSourceImage();
			// TODO: variable-size civic buildings. This assumes a 1x1 footprint.
			// When civic types span multiple tiles (stadium, coal plant, etc.),
			// give CivicManifestEntry tileW/tileH like SpriteManifestEntry and
			// route civic placement through tryCluster instead of this constant.
			const footprintPx = 2 * HALF_W; // civic buildings are always 1x1
			const autoScale = footprintPx / src.width;
			registerCivicSprite(
				cm.civicType,
				tileSpriteEntry(cm.key, {
					originX: cm.originX,
					originY: cm.originY,
					scale: autoScale,
				}),
			);
		}

		this.sprites = new SpritePool(this, "_blank");
		this.covered = new Uint8Array(this.city.width * this.city.height);

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

		// Raise/lower edits one corner or tile per click (repeat to go higher).
		if (isTerraformTool(snap.tool)) {
			this.placeTerraform(x, y, snap.tool);
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

	/**
	 * Elevation-aware picking: front-most surface under the cursor (see
	 * `pickTile`). Also records the fractional in-tile position for
	 * corner-precision terraforming.
	 */
	private pointerTile(pointer: Phaser.Input.Pointer): { x: number; y: number } {
		const pick = pickTile(this.city, pointer.worldX, pointer.worldY);
		this.hoverFx = pick.fx;
		this.hoverFy = pick.fy;
		return { x: pick.x, y: pick.y };
	}

	/** Which part of the hovered tile a terraform click targets. */
	private hoverCorner(): number {
		const dx = this.hoverFx - 0.5;
		const dy = this.hoverFy - 0.5;
		if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return CORNER_ALL;
		const east = this.hoverFx >= 0.5;
		const south = this.hoverFy >= 0.5;
		if (east && south) return CORNER_S;
		if (east) return CORNER_E;
		if (south) return CORNER_W;
		return CORNER_N;
	}

	private placeSingle(x: number, y: number): void {
		if (!this.inBounds(x, y)) return;
		const snap = this.store.getSnapshot();
		const cmd = toolToCommand(snap.tool, x, y, snap.overlay);
		if (cmd !== null) this.sendCommands([cmd]);
	}

	private placeTerraform(x: number, y: number, tool: string): void {
		if (!this.inBounds(x, y)) return;
		this.sendCommands([
			{
				kind: "terraform",
				x,
				y,
				corner: this.hoverCorner(),
				dir: tool === "terraform-raise" ? 1 : -1,
			},
		]);
	}

	/** Commit the current drag as one batch of commands (line or rectangle). */
	private commitDrag(): void {
		const snap = this.store.getSnapshot();
		const tool = snap.tool;
		if (tool === "none") return;

		const cmds: Command[] = [];
		for (const t of this.dragTiles(tool)) {
			if (!this.inBounds(t.x, t.y)) continue;
			const cmd = toolToCommand(tool, t.x, t.y, snap.overlay);
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
		const snap = this.store.getSnapshot();
		const overlay = snap.overlay;

		g.clear();
		this.gOverlay.clear();
		this.sprites.begin();
		this.covered.fill(0);

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

		this.sprites.end();

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
			const go = this.gOverlay;
			go.lineStyle(2, COL_CURSOR, 0.9);
			this.pathHoverFace(go, this.hoverX, this.hoverY, overlay);
			go.strokePath();
			if (isTerraformTool(snap.tool)) this.drawCornerMarker();
		}
	}

	/** Path the terrain surface under the cursor for selection highlighting. */
	private pathHoverFace(
		g: Phaser.GameObjects.Graphics,
		x: number,
		y: number,
		overlay: string,
	): void {
		// Land-value overlay lifts tiles by value — use flat diamond at that height.
		if (overlay === "land-value") {
			const cx = (x - y) * HALF_W;
			const cy = (x + y) * HALF_H;
			diamondPath(g, cx, cy, this.tileTopLift(x, y, overlay));
			return;
		}
		// Everything else highlights at ground level.
		this.pathGroundFace(g, x, y);
	}

	/** Path the terrain surface of a tile: flat water plane or sloped land face.
	 *  For road tiles, uses SC3K-style graded heights so the highlight matches
	 *  the rendered road surface rather than the raw terrain. */
	private pathGroundFace(
		g: Phaser.GameObjects.Graphics,
		x: number,
		y: number,
	): void {
		const city = this.city;
		const idx = y * city.width + x;
		const cx = (x - y) * HALF_W;
		const cy = (x + y) * HALF_H;
		if (city.terrain[idx] === TERRAIN_WATER) {
			diamondPath(g, cx, cy, (city.waterLevel[idx] ?? 0) * ELEV_HEIGHT);
			return;
		}
		const vw = city.width + 1;
		const heights = city.vertexHeights;
		let sn = (heights[y * vw + x] ?? 0) * ELEV_HEIGHT;
		let se = (heights[y * vw + x + 1] ?? 0) * ELEV_HEIGHT;
		let ss = (heights[(y + 1) * vw + x + 1] ?? 0) * ELEV_HEIGHT;
		let sw = (heights[(y + 1) * vw + x] ?? 0) * ELEV_HEIGHT;

		if (city.roads[idx] === 1) {
			roadGrade(city, x, y, idx, sn, se, ss, sw, _roadOut);
			sn = _roadOut[0] ?? 0;
			se = _roadOut[1] ?? 0;
			ss = _roadOut[2] ?? 0;
			sw = _roadOut[3] ?? 0;
		}

		surfacePath(g, cx, cy, sn, se, ss, sw);
	}

	/** Small marker on the corner a terraform click would edit. */
	private drawCornerMarker(): void {
		const corner = this.hoverCorner();
		if (corner === CORNER_ALL) return; // whole tile — the outline suffices
		let vx = this.hoverX;
		let vy = this.hoverY;
		if (corner === CORNER_E) {
			vx += 1;
		} else if (corner === CORNER_S) {
			vx += 1;
			vy += 1;
		} else if (corner === CORNER_W) {
			vy += 1;
		}
		const lift = this.vertexHeight(vx, vy) * ELEV_HEIGHT;
		const px = (vx - vy) * HALF_W;
		const py = (vx + vy) * HALF_H - lift;
		const g = this.gOverlay;
		g.fillStyle(COL_CURSOR, 0.9);
		g.beginPath();
		g.moveTo(px, py - 3);
		g.lineTo(px + 6, py);
		g.lineTo(px, py + 3);
		g.lineTo(px - 6, py);
		g.closePath();
		g.fillPath();
	}

	/** Draw a translucent footprint of the tiles the current drag would place. */
	private drawDragPreview(): void {
		const tool = this.store.getSnapshot().tool;
		if (tool === "none") return;

		const g = this.gOverlay;
		const color = previewColor(tool);
		for (const t of this.dragTiles(tool)) {
			if (!this.inBounds(t.x, t.y)) continue;
			g.fillStyle(color, 0.45);
			this.pathGroundFace(g, t.x, t.y);
			g.fillPath();
			g.lineStyle(1, color, 0.9);
			this.pathGroundFace(g, t.x, t.y);
			g.strokePath();
		}
	}

	/** Corner height (0..ELEVATION_MAX) at vertex (vx, vy) of the corner grid. */
	private vertexHeight(vx: number, vy: number): number {
		return this.city.vertexHeights[vy * (this.city.width + 1) + vx] ?? 0;
	}

	/** World-px lift of the flat pad that structures on tile (x, y) sit on. */
	private tileBaseLift(x: number, y: number): number {
		return tileSurfaceHeight(this.city, x, y) * ELEV_HEIGHT;
	}

	/** World-space height of a tile's top surface in the current overlay mode. */
	private tileTopLift(x: number, y: number, overlay: string): number {
		const city = this.city;
		const idx = y * city.width + x;
		const ground = this.tileBaseLift(x, y);
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

	/** Place a sprite from the pool at the given tile's screen position. */
	private placeTileSprite(
		entry: TileSpriteEntry,
		cx: number,
		cy: number,
		baseLift: number,
		depth: number,
	): void {
		const screenX = cx + (entry.tileW - entry.tileH) * HALF_W + entry.offsetX;
		const screenY =
			cy + (entry.tileW + entry.tileH) * HALF_H - baseLift + entry.offsetY;
		const img = this.sprites.place(
			entry.textureKey,
			entry.frame,
			screenX,
			screenY,
			depth,
			entry.originX,
			entry.originY,
		);
		img.setScale(entry.scale);
	}

	/**
	 * Try to place a multi-tile cluster sprite anchored at (x, y).
	 * Returns true if the cluster was placed, false otherwise.
	 */
	private tryCluster(
		x: number,
		y: number,
		zone: number,
		density: number,
		cluster: TileSpriteEntry,
	): boolean {
		const city = this.city;
		const tw = cluster.tileW;
		const th = cluster.tileH;
		if (x + tw > city.width || y + th > city.height) return false;
		for (let dy = 0; dy < th; dy++) {
			for (let dx = 0; dx < tw; dx++) {
				const idx = (y + dy) * city.width + (x + dx);
				if (this.covered[idx] === 1) return false;
				if ((city.zoning[idx] ?? 0) !== zone) return false;
				if ((city.building[idx] ?? 0) !== density) return false;
			}
		}
		let clusterBaseLift = 0;
		for (let dy = 0; dy < th; dy++) {
			for (let dx = 0; dx < tw; dx++) {
				const lift = tileSurfaceHeight(city, x + dx, y + dy) * ELEV_HEIGHT;
				if (lift > clusterBaseLift) clusterBaseLift = lift;
			}
		}
		const cx = (x - y) * HALF_W;
		const cy = (x + y) * HALF_H;
		const depth = x + y + tw + th - 2;
		this.placeTileSprite(cluster, cx, cy, clusterBaseLift, depth);
		for (let dy = 0; dy < th; dy++) {
			for (let dx = 0; dx < tw; dx++) {
				this.covered[(y + dy) * city.width + (x + dx)] = 1;
			}
		}
		return true;
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
		// Water pipes are underground — they don't affect surface rendering.
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

		// Per-corner terrain lifts; water is a flat plane at its surface level.
		const vw = city.width + 1;
		const heights = city.vertexHeights;
		const hn = heights[y * vw + x] ?? 0;
		const he = heights[y * vw + x + 1] ?? 0;
		const hs = heights[(y + 1) * vw + x + 1] ?? 0;
		const hw = heights[(y + 1) * vw + x] ?? 0;

		let ln: number;
		let le: number;
		let ls: number;
		let lw: number;
		if (isWater) {
			const wl = (city.waterLevel[idx] ?? 0) * ELEV_HEIGHT;
			ln = wl;
			le = wl;
			ls = wl;
			lw = wl;
		} else {
			ln = hn * ELEV_HEIGHT;
			le = he * ELEV_HEIGHT;
			ls = hs * ELEV_HEIGHT;
			lw = hw * ELEV_HEIGHT;
		}
		const baseLift = Math.max(ln, le, ls, lw);
		const minLift = Math.min(ln, le, ls, lw);

		// SC3K-style roads: compute graded surface heights before terrain
		// rendering so the ground is shaped to match the road — no floating.
		let rn = ln;
		let re = le;
		let rs = ls;
		let rw = lw;
		if (isRoad) {
			roadGrade(city, x, y, idx, ln, le, ls, lw, _roadOut);
			rn = _roadOut[0] ?? 0;
			re = _roadOut[1] ?? 0;
			rs = _roadOut[2] ?? 0;
			rw = _roadOut[3] ?? 0;
		}

		// Terrain block: for roads, the ground is graded to match the road
		// surface so skirts and earth connect flush with no gap.
		const gn = isRoad ? rn : ln;
		const ge = isRoad ? re : le;
		const gs = isRoad ? rs : ls;
		const gw = isRoad ? rw : lw;

		skirts(g, cx, cy, ge, gs, gw, isWater ? COL_WATER : COL_EARTH);
		if (isWater) {
			g.fillStyle(COL_WATER, 1);
		} else {
			g.fillStyle(shade(COL_GRASS, slopeShade(hn, he, hs, hw)), 1);
		}
		surfacePath(g, cx, cy, gn, ge, gs, gw);
		g.fillPath();

		// Road surface painted on the graded terrain.
		if (isRoad) {
			g.fillStyle(top, 1);
			surfacePath(g, cx, cy, rn, re, rs, rw);
			g.fillPath();
		}

		// Everything else built sits on a flat pad at the tile's highest
		// corner; on a sloped tile the pad gets an earth foundation, RCT-style.
		const flatTop =
			!isRoad && (isRail || isPowerLine || civicType !== 0 || buildHeight > 0);
		const topLift = baseLift + buildHeight;
		if (flatTop) {
			if (minLift < baseLift) {
				extrudeColumn(g, cx, cy, minLift, baseLift, COL_EARTH);
			}

			const isCovered = this.covered[idx] === 1;
			let usedSprite = isCovered;
			if (buildHeight > 0 && !isCovered) {
				// Try cluster sprite for zoned buildings
				if (civicType === 0) {
					const bZone = city.zoning[idx] ?? 0;
					const bDensity = city.building[idx] ?? 0;
					const cluster = getClusterSprite(bZone, bDensity);
					if (
						cluster !== undefined &&
						this.tryCluster(x, y, bZone, bDensity, cluster)
					) {
						usedSprite = true;
					}
				}
				// Fall back to solo sprite
				if (!usedSprite) {
					const spriteEntry =
						civicType !== 0
							? getCivicSprite(civicType)
							: getBuildingSprite(
									city.zoning[idx] ?? 0,
									city.building[idx] ?? 0,
								);
					if (spriteEntry !== undefined) {
						this.placeTileSprite(spriteEntry, cx, cy, baseLift, x + y);
						usedSprite = true;
					} else {
						extrudeColumn(g, cx, cy, baseLift, topLift, top);
					}
				}
			}

			if (!usedSprite) {
				g.fillStyle(top, 1);
				diamondPath(g, cx, cy, topLift);
				g.fillPath();
			}
		}

		// ---- Overlays (drawn above building sprites) ---
		const go = this.gOverlay;

		// The visible top face, for zone outlines and overlay tints.
		const tn = flatTop ? topLift : isRoad ? rn : ln;
		const te = flatTop ? topLift : isRoad ? re : le;
		const ts = flatTop ? topLift : isRoad ? rs : ls;
		const tw = flatTop ? topLift : isRoad ? rw : lw;

		// Empty zoned land: colored outline so zoning reads before it builds.
		if (!flatTop && !isWater) {
			const zoneOutline = zoneOutlineColor(city.zoning[idx] ?? 0);
			if (zoneOutline >= 0) {
				go.lineStyle(1.5, zoneOutline, 0.9);
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.strokePath();
			}
		}

		// Fire indicator (always visible regardless of overlay)
		if (city.fire[idx] === 1) {
			go.fillStyle(COL_FIRE_OV, 0.7);
			surfacePath(go, cx, cy, tn, te, ts, tw);
			go.fillPath();
		}

		// Overlay tints
		if (overlay === "pollution") {
			const pol = city.pollution[idx] ?? 0;
			if (pol > 0) {
				go.fillStyle(COL_POLLUTION, Math.min(0.6, (pol / 255) * 0.7));
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "power") {
			if (!isWater) {
				const powered = city.power[idx] === 1;
				go.fillStyle(powered ? COL_POWERED : COL_UNPOWERED, 0.45);
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "water") {
			if (!isWater) {
				const watered = city.waterCoverage[idx] === 1;
				const hasPipe = city.waterPipes[idx] === 1;
				const isConduit = hasPipe || isRoad;
				if (isConduit) {
					const col = watered ? COL_WATER_PIPE : COL_PIPE_DISCONNECTED;
					go.fillStyle(col, 0.7);
				} else {
					go.fillStyle(watered ? COL_WATERED : COL_UNWATERED, 0.45);
				}
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "underground") {
			if (!isWater) {
				const watered = city.waterCoverage[idx] === 1;
				const hasPipe = city.waterPipes[idx] === 1;
				const isPump = (city.civic[idx] ?? 0) === CIVIC_WATER_PUMP;
				if (hasPipe) {
					const col = watered ? COL_WATER_PIPE : COL_PIPE_DISCONNECTED;
					go.fillStyle(col, 0.8);
				} else if (isRoad) {
					const col = watered ? COL_WATER_PIPE : COL_PIPE_DISCONNECTED;
					go.fillStyle(col, 0.4);
				} else if (isPump) {
					go.fillStyle(COL_WATER_PIPE, 0.8);
				} else {
					go.fillStyle(0x000000, 0.5);
				}
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "crime") {
			const cr = city.crime[idx] ?? 0;
			if (cr > 0) {
				go.fillStyle(COL_CRIME, Math.min(0.7, (cr / 255) * 0.8));
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "traffic") {
			const tr = city.traffic[idx] ?? 0;
			if (tr > 0) {
				go.fillStyle(COL_TRAFFIC_OV, Math.min(0.7, (tr / 255) * 0.8));
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "police") {
			if (!isWater) {
				const covered = city.policeCoverage[idx] === 1;
				go.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "fire") {
			if (!isWater) {
				const covered = city.fireCoverage[idx] === 1;
				go.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "education") {
			if (!isWater) {
				const covered = city.educationCoverage[idx] === 1;
				go.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
			}
		} else if (overlay === "health") {
			if (!isWater) {
				const covered = city.healthCoverage[idx] === 1;
				go.fillStyle(covered ? COL_POWERED : COL_UNPOWERED, 0.45);
				surfacePath(go, cx, cy, tn, te, ts, tw);
				go.fillPath();
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
			const wl = (city.waterLevel[idx] ?? 0) * ELEV_HEIGHT;
			skirts(g, cx, cy, wl, wl, wl, COL_WATER);
			g.fillStyle(COL_WATER, 1);
			diamondPath(g, cx, cy, wl);
			g.fillPath();
			return;
		}

		const vw = city.width + 1;
		const heights = city.vertexHeights;
		const hn = heights[y * vw + x] ?? 0;
		const he = heights[y * vw + x + 1] ?? 0;
		const hs = heights[(y + 1) * vw + x + 1] ?? 0;
		const hw = heights[(y + 1) * vw + x] ?? 0;
		const ln = hn * ELEV_HEIGHT;
		const le = he * ELEV_HEIGHT;
		const ls = hs * ELEV_HEIGHT;
		const lw = hw * ELEV_HEIGHT;
		const ground = Math.max(ln, le, ls, lw);

		const lv = city.landValue[idx] ?? 0;
		const valueH = Math.min(lv, LV_HEIGHT_CLAMP) * LV_HEIGHT_PER_UNIT;
		const col = isRoad ? COL_ROAD : builtColor(city.zoning[idx] ?? 0);

		// Sloped terrain in earth tones, then the land-value column rising from
		// the tile's highest corner.
		skirts(g, cx, cy, le, ls, lw, COL_EARTH);
		g.fillStyle(shade(COL_EARTH, slopeShade(hn, he, hs, hw)), 1);
		surfacePath(g, cx, cy, ln, le, ls, lw);
		g.fillPath();

		if (valueH > 0) extrudeColumn(g, cx, cy, ground, ground + valueH, col);
		g.fillStyle(col, 1);
		diamondPath(g, cx, cy, ground + valueH);
		g.fillPath();
	}
}

// ---- Geometry helpers ------------------------------------------------------
// Tile (x, y)'s screen origin (cx, cy) = ((x-y)*HALF_W, (x+y)*HALF_H) is its
// NORTH corner (vertex (x, y)) at lift 0. The other corners sit at
// E = (cx+HALF_W, cy+HALF_H), S = (cx, cy+2*HALF_H), W = (cx-HALF_W, cy+HALF_H);
// lifts subtract from screen y. This matches `screenToGrid`, so picking and
// geometry agree.

/**
 * Path the (possibly sloped) top face of a tile, with an independent lift in
 * world-px at each corner (N, E, S, W).
 */
function surfacePath(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	ln: number,
	le: number,
	ls: number,
	lw: number,
): void {
	g.beginPath();
	g.moveTo(cx, cy - ln);
	g.lineTo(cx + HALF_W, cy + HALF_H - le);
	g.lineTo(cx, cy + 2 * HALF_H - ls);
	g.lineTo(cx - HALF_W, cy + HALF_H - lw);
	g.closePath();
}

/** Flat diamond at a uniform lift (building pads, water planes, column tops). */
function diamondPath(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	lift: number,
): void {
	surfacePath(g, cx, cy, lift, lift, lift, lift);
}

/**
 * Terrain side skirts: the two viewer-facing faces dropping from the tile's
 * E/S/W corner lifts down to lift 0. Mostly hidden behind nearer tiles;
 * visible at the map edge and along water lines.
 */
function skirts(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	le: number,
	ls: number,
	lw: number,
	color: number,
): void {
	if (lw > 0 || ls > 0) {
		g.fillStyle(shade(color, 0.6), 1);
		quad(
			g,
			cx - HALF_W,
			cy + HALF_H,
			cx,
			cy + 2 * HALF_H,
			cx,
			cy + 2 * HALF_H - ls,
			cx - HALF_W,
			cy + HALF_H - lw,
		);
	}
	if (ls > 0 || le > 0) {
		g.fillStyle(shade(color, 0.8), 1);
		quad(
			g,
			cx,
			cy + 2 * HALF_H,
			cx + HALF_W,
			cy + HALF_H,
			cx + HALF_W,
			cy + HALF_H - le,
			cx,
			cy + 2 * HALF_H - ls,
		);
	}
}

/**
 * Draw the two visible side faces of a flat-topped column spanning `baseLift`
 * to `topLift` world-pixels. Used for buildings and foundation pads.
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
		cy + HALF_H - baseLift,
		cx,
		cy + 2 * HALF_H - baseLift,
		cx,
		cy + 2 * HALF_H - topLift,
		cx - HALF_W,
		cy + HALF_H - topLift,
	);
	g.fillStyle(shade(top, 0.8), 1);
	quad(
		g,
		cx,
		cy + 2 * HALF_H - baseLift,
		cx + HALF_W,
		cy + HALF_H - baseLift,
		cx + HALF_W,
		cy + HALF_H - topLift,
		cx,
		cy + 2 * HALF_H - topLift,
	);
}

// Pre-allocated output buffer for roadGrade (avoids allocation in hot path).
const _roadOut = new Float64Array(4);

/**
 * SC3K-style road grading: slopes along travel direction, flat perpendicular.
 * Writes graded corner heights (N, E, S, W) into `out[0..3]`.
 */
function roadGrade(
	city: CityState,
	x: number,
	y: number,
	idx: number,
	ln: number,
	le: number,
	ls: number,
	lw: number,
	out: Float64Array,
): void {
	const w = city.width;
	const h = city.height;
	const roadN = y > 0 && city.roads[idx - w] === 1;
	const roadS = y < h - 1 && city.roads[idx + w] === 1;
	const roadW = x > 0 && city.roads[idx - 1] === 1;
	const roadE = x < w - 1 && city.roads[idx + 1] === 1;

	const xConn = roadW || roadE;
	const yConn = roadN || roadS;

	if (xConn && !yConn) {
		const leftAvg = (ln + lw) / 2;
		const rightAvg = (le + ls) / 2;
		out[0] = leftAvg;
		out[1] = rightAvg;
		out[2] = rightAvg;
		out[3] = leftAvg;
	} else if (yConn && !xConn) {
		const topAvg = (ln + le) / 2;
		const botAvg = (lw + ls) / 2;
		out[0] = topAvg;
		out[1] = topAvg;
		out[2] = botAvg;
		out[3] = botAvg;
	} else {
		const avg = (ln + le + ls + lw) / 4;
		out[0] = avg;
		out[1] = avg;
		out[2] = avg;
		out[3] = avg;
	}
}

/**
 * Brightness multiplier for a sloped grass face — corners tilting toward the
 * upper-left light source brighten, away darken. Flat tiles return 1.
 */
function slopeShade(hn: number, he: number, hs: number, hw: number): number {
	const f = 1 + (hn + hw - he - hs) * SLOPE_SHADE;
	return Math.max(0.7, Math.min(1.3, f));
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
	return (
		tool === "road" ||
		tool === "rail" ||
		tool === "power-line" ||
		tool === "water-pipe"
	);
}

/** Whether a tool raises/lowers terrain (single-click, corner-aware). */
function isTerraformTool(tool: string): boolean {
	return tool === "terraform-raise" || tool === "terraform-lower";
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
		case "water-pipe":
			return COL_WATER_PIPE;
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
		case "water":
			return COL_WATER;
		case "drain":
			return COL_EARTH;
		default:
			return COL_CURSOR;
	}
}

// ---- Command mapping -------------------------------------------------------

function toolToCommand(
	tool: string,
	x: number,
	y: number,
	overlay: string,
): Command | null {
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
		case "water-pipe":
			return { kind: "build-water-pipe", x, y };
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
			if (overlay === "underground") return { kind: "demolish-pipe", x, y };
			return { kind: "demolish", x, y };
		case "water":
			return { kind: "set-water", x, y, place: true };
		case "drain":
			return { kind: "set-water", x, y, place: false };
		default:
			return null;
	}
}
