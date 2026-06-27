/**
 * Input handling — mouse and keyboard events mapped to tool application,
 * camera control, and app state changes.
 */

import { screenToTile } from "./renderer.ts";
import type { Command } from "./sim/commands.ts";
import {
	ZONE_COMMERCIAL,
	ZONE_INDUSTRIAL,
	ZONE_RESIDENTIAL,
} from "./sim/constants.ts";
import type { AppState, Tool } from "./types.ts";

export function setupInput(
	canvas: HTMLCanvasElement,
	appState: AppState,
	cityWidth: number,
	cityHeight: number,
	onStateChange: () => void,
): void {
	let isApplying = false;
	let isPanning = false;
	let lastPanX = 0;
	let lastPanY = 0;
	let lastTileX = -1;
	let lastTileY = -1;

	function canvasCoords(e: MouseEvent): { cx: number; cy: number } {
		const rect = canvas.getBoundingClientRect();
		return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
	}

	function tileAt(cx: number, cy: number): { x: number; y: number } {
		return screenToTile(
			cx,
			cy,
			appState.camera.offsetX,
			appState.camera.offsetY,
			appState.camera.tileSize,
		);
	}

	function applyTool(tx: number, ty: number): void {
		if (tx < 0 || tx >= cityWidth || ty < 0 || ty >= cityHeight) return;
		const cmd = toolToCommand(appState.tool, tx, ty);
		if (cmd !== null) {
			appState.commands.push(cmd);
		}
	}

	canvas.addEventListener("mousedown", (e) => {
		const { cx, cy } = canvasCoords(e);

		if (e.button === 0 && appState.tool !== "none") {
			isApplying = true;
			const tile = tileAt(cx, cy);
			applyTool(tile.x, tile.y);
			lastTileX = tile.x;
			lastTileY = tile.y;
		}

		if (e.button === 1 || e.button === 2) {
			isPanning = true;
			lastPanX = e.clientX;
			lastPanY = e.clientY;
		}

		e.preventDefault();
	});

	canvas.addEventListener("mousemove", (e) => {
		const { cx, cy } = canvasCoords(e);
		const tile = tileAt(cx, cy);

		appState.cursorTile =
			tile.x >= 0 && tile.x < cityWidth && tile.y >= 0 && tile.y < cityHeight
				? tile
				: null;

		if (isApplying) {
			if (tile.x !== lastTileX || tile.y !== lastTileY) {
				applyTool(tile.x, tile.y);
				lastTileX = tile.x;
				lastTileY = tile.y;
			}
		}

		if (isPanning) {
			appState.camera.offsetX -= e.clientX - lastPanX;
			appState.camera.offsetY -= e.clientY - lastPanY;
			lastPanX = e.clientX;
			lastPanY = e.clientY;
		}
	});

	canvas.addEventListener("mouseup", () => {
		isApplying = false;
		isPanning = false;
	});

	canvas.addEventListener("mouseleave", () => {
		isApplying = false;
		isPanning = false;
		appState.cursorTile = null;
	});

	canvas.addEventListener("contextmenu", (e) => e.preventDefault());

	// Zoom toward cursor
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			const { cx, cy } = canvasCoords(e);
			const cam = appState.camera;

			const tileX = (cx + cam.offsetX) / cam.tileSize;
			const tileY = (cy + cam.offsetY) / cam.tileSize;

			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			cam.tileSize = Math.max(4, Math.min(48, cam.tileSize * factor));

			cam.offsetX = tileX * cam.tileSize - cx;
			cam.offsetY = tileY * cam.tileSize - cy;
		},
		{ passive: false },
	);

	// Keyboard shortcuts
	window.addEventListener("keydown", (e) => {
		// Don't capture if user is in an input element
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		) {
			return;
		}

		const PAN_STEP = appState.camera.tileSize * 4;
		let handled = true;

		switch (e.key) {
			case "1":
				appState.tool = "zone-r";
				break;
			case "2":
				appState.tool = "zone-c";
				break;
			case "3":
				appState.tool = "zone-i";
				break;
			case "r":
			case "R":
				appState.tool = "road";
				break;
			case "x":
			case "X":
				appState.tool = "demolish";
				break;
			case "Escape":
				appState.tool = "none";
				break;
			case " ":
				appState.speed = appState.speed === 0 ? 1 : 0;
				break;
			case "ArrowLeft":
			case "a":
			case "A":
				appState.camera.offsetX -= PAN_STEP;
				break;
			case "ArrowRight":
			case "d":
			case "D":
				appState.camera.offsetX += PAN_STEP;
				break;
			case "ArrowUp":
			case "w":
			case "W":
				appState.camera.offsetY -= PAN_STEP;
				break;
			case "ArrowDown":
			case "s":
			case "S":
				appState.camera.offsetY += PAN_STEP;
				break;
			case "=":
			case "+":
				appState.camera.tileSize = Math.min(
					48,
					appState.camera.tileSize * 1.25,
				);
				break;
			case "-":
				appState.camera.tileSize = Math.max(4, appState.camera.tileSize / 1.25);
				break;
			default:
				handled = false;
		}

		if (handled) {
			e.preventDefault();
			onStateChange();
		}
	});
}

function toolToCommand(tool: Tool, x: number, y: number): Command | null {
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
		case "none":
			return null;
	}
}
