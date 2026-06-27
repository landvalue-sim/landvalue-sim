/**
 * Game loop — requestAnimationFrame with fixed-timestep sim ticks.
 *
 * The sim runs at a rate determined by the current speed setting.
 * Rendering happens every frame regardless of speed.
 */

import type { CityState } from "./sim/city-state.ts";
import { tick } from "./sim/tick.ts";
import type { AppState } from "./types.ts";

// Milliseconds per sim tick at each speed level
const TICK_INTERVALS: readonly [number, number, number, number] = [
	0, 250, 83, 33,
];

const MAX_TICKS_PER_FRAME = 10;

export function startGameLoop(
	city: CityState,
	appState: AppState,
	onFrame: () => void,
): () => void {
	let lastTime = 0;
	let accumulator = 0;
	let running = true;

	function loop(time: number): void {
		if (!running) return;

		const dt = lastTime === 0 ? 0 : time - lastTime;
		lastTime = time;

		const interval = TICK_INTERVALS[appState.speed];

		if (interval > 0) {
			accumulator += dt;
			const frameCommands = appState.commands.slice();
			appState.commands.length = 0;

			let ticks = 0;
			while (accumulator >= interval && ticks < MAX_TICKS_PER_FRAME) {
				tick(city, ticks === 0 ? frameCommands : []);
				accumulator -= interval;
				ticks++;
			}
		} else if (appState.commands.length > 0) {
			// Paused but commands pending — run one tick so zones/roads appear
			const frameCommands = appState.commands.slice();
			appState.commands.length = 0;
			tick(city, frameCommands);
		}

		onFrame();
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);

	return () => {
		running = false;
	};
}
