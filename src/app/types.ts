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
	| "water-pipe"
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
	| "level"
	| "water"
	| "drain";

export type OverlayMode =
	| "none"
	| "land-value"
	| "pollution"
	| "power"
	| "water"
	| "underground"
	| "crime"
	| "traffic"
	| "police"
	| "fire"
	| "education"
	| "health"
  | "population-density";

// Sim speed: 0 = paused, then seven ascending tiers (slowest … fastest),
// mirroring the Cities: Skylines / Stellaris speed ladder.
export type Speed = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
