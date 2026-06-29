/**
 * Player commands — a discriminated union of all actions a player can issue.
 *
 * Commands are queued between ticks and applied atomically at the start of
 * each tick by the command processor.
 */

export interface ZoneCommand {
	readonly kind: "zone";
	readonly x: number;
	readonly y: number;
	/** 0 = de-zone, 1 = R, 2 = C, 3 = I */
	readonly zoneType: number;
	/** DENSITY_LOW / MED / HIGH. Defaults to DENSITY_LOW in the processor. */
	readonly density?: number;
}

export interface BuildRoadCommand {
	readonly kind: "build-road";
	readonly x: number;
	readonly y: number;
}

export interface BuildRailCommand {
	readonly kind: "build-rail";
	readonly x: number;
	readonly y: number;
}

export interface BuildPowerLineCommand {
	readonly kind: "build-power-line";
	readonly x: number;
	readonly y: number;
}

export interface PlaceCivicCommand {
	readonly kind: "place-civic";
	readonly x: number;
	readonly y: number;
	/** CIVIC_COAL_PLANT / CIVIC_SOLAR_PLANT / CIVIC_WATER_PUMP */
	readonly civicType: number;
}

export interface DemolishCommand {
	readonly kind: "demolish";
	readonly x: number;
	readonly y: number;
}

export interface SetTaxRateCommand {
	readonly kind: "set-tax-rate";
	/** "r" | "c" | "i" */
	readonly sector: "r" | "c" | "i";
	/** 0.0 – 0.20 */
	readonly rate: number;
}

export type Command =
	| ZoneCommand
	| BuildRoadCommand
	| BuildRailCommand
	| BuildPowerLineCommand
	| PlaceCivicCommand
	| DemolishCommand
	| SetTaxRateCommand;
