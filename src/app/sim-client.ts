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

export interface SimClient {
	readonly city: CityState;
	sendCommands(commands: ReadonlyArray<Command>): void;
	setSpeed(speed: Speed): void;
	clearViolations(): void;
	/** Replace the current city with a deterministic pre-built test city. */
	loadTestCity(): void;
	onStats(listener: StatsListener): () => void;
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

	const worker = new Worker(
		new URL("../worker/sim-worker.ts", import.meta.url),
		{ type: "module", name: "sim-worker" },
	);

	const statsListeners = new Set<StatsListener>();

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
		onStats(listener) {
			statsListeners.add(listener);
			return () => {
				statsListeners.delete(listener);
			};
		},
		dispose() {
			statsListeners.clear();
			worker.terminate();
		},
	};
}
