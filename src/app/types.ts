/** Front-end interaction types shared by the UI and the render shell. */

export type Tool =
	| "none"
	| "zone-r"
	| "zone-c"
	| "zone-i"
	| "road"
	| "demolish";

export type OverlayMode = "none" | "land-value" | "pollution";

export type Speed = 0 | 1 | 2 | 3;
