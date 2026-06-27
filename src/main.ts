import { startGameLoop } from "./game-loop.ts";
import { setupInput } from "./input.ts";
import { render } from "./renderer.ts";
import { createCity } from "./sim/index.ts";
import "./style.css";
import type { AppState, OverlayMode, Speed, Tool } from "./types.ts";
import { createUi, type UiElements, updateUi } from "./ui.ts";

// ---- City state ------------------------------------------------------------
const city = createCity({ width: 64, height: 64, seed: 42 });

// ---- App state -------------------------------------------------------------
const appState: AppState = {
	tool: "none",
	overlay: "none",
	speed: 1,
	camera: { offsetX: 0, offsetY: 0, tileSize: 12 },
	commands: [],
	cursorTile: null,
};

// ---- DOM setup -------------------------------------------------------------
const app = document.getElementById("app");
if (app === null) throw new Error("Missing #app element");

// Viewport + canvas
const viewport = document.createElement("main");
viewport.id = "viewport";
const canvas = document.createElement("canvas");
canvas.id = "game-canvas";
viewport.appendChild(canvas);
app.appendChild(viewport);

const ctx = canvas.getContext("2d");
if (ctx === null) throw new Error("Canvas 2D context unavailable");

// UI sidebar
const ui: UiElements = createUi(app, {
	onToolSelect(tool: Tool) {
		appState.tool = appState.tool === tool ? "none" : tool;
	},
	onOverlaySelect(overlay: OverlayMode) {
		appState.overlay = appState.overlay === overlay ? "none" : overlay;
	},
	onSpeedSelect(speed: Speed) {
		appState.speed = speed;
	},
});

// ---- Input -----------------------------------------------------------------
setupInput(canvas, appState, city.width, city.height, () => {
	updateUi(ui, city, appState);
});

// ---- Canvas sizing ---------------------------------------------------------
let needsCenter = true;

function ensureCanvasSize(): void {
	const w = canvas.clientWidth;
	const h = canvas.clientHeight;
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
}

// ---- Game loop -------------------------------------------------------------
startGameLoop(city, appState, () => {
	ensureCanvasSize();

	if (needsCenter) {
		const gridW = city.width * appState.camera.tileSize;
		const gridH = city.height * appState.camera.tileSize;
		appState.camera.offsetX = gridW / 2 - canvas.width / 2;
		appState.camera.offsetY = gridH / 2 - canvas.height / 2;
		needsCenter = false;
	}

	render(ctx, canvas.width, canvas.height, city, appState);
	updateUi(ui, city, appState);
});
