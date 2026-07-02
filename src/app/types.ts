/** Front-end interaction types shared by the UI and the render shell. */

export type Tool =
	| "none"
	| "zone-r-low"
	| "zone-r-med"
	| "zone-r-high"
	| "zone-c-low"
	| "zone-c-med"
	| "zone-c-high"
	| "zone-i-low"
	| "zone-i-med"
	| "zone-i-high"
	| "road"
	| "rail"
	| "power-line"
	| "coal-plant"
	| "solar-plant"
	| "water-pump"
	| "police"
	| "fire-station"
	| "hospital"
	| "school"
	| "college"
	| "library"
	| "park"
	| "stadium"
	| "demolish"
	| "terraform-raise"
	| "terraform-lower"
	| "water"
	| "drain";

export type OverlayMode =
	| "none"
	| "land-value"
	| "pollution"
	| "power"
	| "water"
	| "crime"
	| "traffic"
	| "police"
	| "fire"
	| "education"
	| "health";

export type Speed = 0 | 1 | 2 | 3;
