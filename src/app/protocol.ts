/**
 * Message protocol between the main thread and the simulation worker.
 *
 * The city state itself never travels through these messages — it lives in a
 * `SharedArrayBuffer` that both threads alias. Messages only carry control
 * signals (commands, speed) and, in dev builds, profiler/violation snapshots
 * for the dev panel.
 */

import type { Command } from "../sim/commands.ts";
import type { ProfileSnapshot, Violation } from "../sim/index.ts";
import type { Speed } from "./types.ts";

// ---- Main -> Worker --------------------------------------------------------

export interface InitMessage {
	readonly type: "init";
	readonly buffer: SharedArrayBuffer;
	readonly width: number;
	readonly height: number;
	readonly seed: number;
}

export interface CommandsMessage {
	readonly type: "commands";
	readonly commands: ReadonlyArray<Command>;
}

export interface SpeedMessage {
	readonly type: "speed";
	readonly speed: Speed;
}

export interface ClearViolationsMessage {
	readonly type: "clear-violations";
}

export interface LoadTestCityMessage {
	readonly type: "load-test-city";
}

export interface SetInfiniteMoneyMessage {
	readonly type: "set-infinite-money";
	readonly enabled: boolean;
}

export type ToWorkerMessage =
	| InitMessage
	| CommandsMessage
	| SpeedMessage
	| ClearViolationsMessage
	| LoadTestCityMessage
	| SetInfiniteMoneyMessage;

// ---- Worker -> Main --------------------------------------------------------

export interface ReadyMessage {
	readonly type: "ready";
}

export interface StatsMessage {
	readonly type: "stats";
	readonly profile: ProfileSnapshot;
	readonly violations: ReadonlyArray<Violation>;
}

export type FromWorkerMessage = ReadyMessage | StatsMessage;
