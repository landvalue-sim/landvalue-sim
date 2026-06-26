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
}

export interface BuildRoadCommand {
	readonly kind: "build-road";
	readonly x: number;
	readonly y: number;
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
	| DemolishCommand
	| SetTaxRateCommand;
