/**
 * SimClient — the main thread's handle to the simulation worker.
 *
 * It allocates the `SharedArrayBuffer`, initializes the city into it, spins up
 * the worker, and hands the worker its own view of the same buffer. The render
 * shell and UI read `client.city` directly (zero-copy); control flows the other
 * way as messages.
 */

import type { Command } from "../sim/commands.ts";
import {
	type CityState,
	cityByteLength,
	createCity,
	generateTerrain,
	type ProfileSnapshot,
	type Violation,
} from "../sim/index.ts";
import type { FromWorkerMessage, ToWorkerMessage } from "./protocol.ts";
import type { Speed } from "./types.ts";

export interface SimStats {
	readonly profile: ProfileSnapshot;
	readonly violations: ReadonlyArray<Violation>;
}

export type StatsListener = (stats: SimStats) => void;
export type UndoDepthListener = (depth: number) => void;

export interface SimClient {
	readonly city: CityState;
	sendCommands(commands: ReadonlyArray<Command>): void;
	setSpeed(speed: Speed): void;
	clearViolations(): void;
	/** Replace the current city with a deterministic pre-built test city. */
	loadTestCity(): void;
	/** Toggle the infinite-money debug cheat (dev builds only). */
	setInfiniteMoney(enabled: boolean): void;
	/** Roll back the most recent edit. A no-op when nothing is undoable. */
	undo(): void;
	onStats(listener: StatsListener): () => void;
	/** Subscribe to how many edits are currently undoable. */
	onUndoDepth(listener: UndoDepthListener): () => void;
	dispose(): void;
}

export interface SimClientOptions {
	width: number;
	height: number;
	seed: number;
}

export function createSimClient(opts: SimClientOptions): SimClient {
	if (typeof SharedArrayBuffer === "undefined" || !self.crossOriginIsolated) {
		throw new Error(
			"SharedArrayBuffer requires cross-origin isolation. The server must " +
				"send Cross-Origin-Opener-Policy: same-origin and " +
				"Cross-Origin-Embedder-Policy: require-corp (see vite.config.ts).",
		);
	}

	const { width, height, seed } = opts;
	const buffer = new SharedArrayBuffer(cityByteLength(width, height));

	// Initialize the city into the shared buffer on this thread, then hand the
	// same buffer to the worker, which aliases it without re-initializing.
	const city = createCity({ width, height, seed, buffer });
	generateTerrain(city, seed);

	const worker = new Worker(
		new URL("../worker/sim-worker.ts", import.meta.url),
		{ type: "module", name: "sim-worker" },
	);

	const statsListeners = new Set<StatsListener>();
	const undoListeners = new Set<UndoDepthListener>();
	// Last depth the worker reported, replayed to late subscribers so a listener
	// mounting after an edit still sees the current value.
	let undoDepth = 0;

	worker.addEventListener(
		"message",
		(event: MessageEvent<FromWorkerMessage>) => {
			const msg = event.data;
			if (msg.type === "stats") {
				const stats: SimStats = {
					profile: msg.profile,
					violations: msg.violations,
				};
				for (const listener of statsListeners) {
					listener(stats);
				}
			} else if (msg.type === "undo-depth") {
				undoDepth = msg.depth;
				for (const listener of undoListeners) {
					listener(undoDepth);
				}
			}
		},
	);

	function send(msg: ToWorkerMessage): void {
		worker.postMessage(msg);
	}

	send({ type: "init", buffer, width, height, seed });

	return {
		city,
		sendCommands(commands) {
			if (commands.length === 0) return;
			send({ type: "commands", commands });
		},
		setSpeed(speed) {
			send({ type: "speed", speed });
		},
		clearViolations() {
			send({ type: "clear-violations" });
		},
		loadTestCity() {
			send({ type: "load-test-city" });
		},
		setInfiniteMoney(enabled) {
			send({ type: "set-infinite-money", enabled });
		},
		undo() {
			send({ type: "undo" });
		},
		onStats(listener) {
			statsListeners.add(listener);
			return () => {
				statsListeners.delete(listener);
			};
		},
		onUndoDepth(listener) {
			undoListeners.add(listener);
			listener(undoDepth);
			return () => {
				undoListeners.delete(listener);
			};
		},
		dispose() {
			statsListeners.clear();
			undoListeners.clear();
			worker.terminate();
		},
	};
}
