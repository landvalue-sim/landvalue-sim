import type { Command } from "./sim/commands.ts";

export type Tool =
	| "none"
	| "zone-r"
	| "zone-c"
	| "zone-i"
	| "road"
	| "demolish";

export type OverlayMode = "none" | "land-value" | "pollution";

export type Speed = 0 | 1 | 2 | 3;

export interface Camera {
	offsetX: number;
	offsetY: number;
	tileSize: number;
}

export interface AppState {
	tool: Tool;
	overlay: OverlayMode;
	speed: Speed;
	camera: Camera;
	commands: Command[];
	cursorTile: { x: number; y: number } | null;
}
