/**
 * InteractionStore — the small slice of UI state shared between React and the
 * Phaser render shell: the active tool, the active overlay, and the sim speed.
 *
 * React subscribes via `useSyncExternalStore`; the Phaser scene polls
 * `getSnapshot()` each frame to know which tool/overlay are active. Speed
 * changes are forwarded to the worker through the `SimClient`.
 */

import type { SimClient } from "./sim-client.ts";
import type { OverlayMode, Speed, Tool } from "./types.ts";

export interface InteractionSnapshot {
	readonly tool: Tool;
	readonly overlay: OverlayMode;
	readonly speed: Speed;
}

export interface InteractionStore {
	subscribe(listener: () => void): () => void;
	getSnapshot(): InteractionSnapshot;
	setTool(tool: Tool): void;
	toggleTool(tool: Tool): void;
	setOverlay(overlay: OverlayMode): void;
	setSpeed(speed: Speed): void;
	togglePause(): void;
	/** Install global keyboard shortcuts; returns a teardown function. */
	installKeyboard(): () => void;
}

export function createStore(sim: SimClient): InteractionStore {
	let snapshot: InteractionSnapshot = {
		tool: "none",
		overlay: "none",
		speed: 1,
	};
	const listeners = new Set<() => void>();

	function emit(): void {
		for (const listener of listeners) listener();
	}

	function update(next: Partial<InteractionSnapshot>): void {
		const merged: InteractionSnapshot = { ...snapshot, ...next };
		if (
			merged.tool === snapshot.tool &&
			merged.overlay === snapshot.overlay &&
			merged.speed === snapshot.speed
		) {
			return;
		}
		snapshot = merged;
		emit();
	}

	function setSpeed(speed: Speed): void {
		if (speed !== snapshot.speed) sim.setSpeed(speed);
		update({ speed });
	}

	const store: InteractionStore = {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot() {
			return snapshot;
		},
		setTool(tool) {
			update({ tool });
		},
		toggleTool(tool) {
			update({ tool: snapshot.tool === tool ? "none" : tool });
		},
		setOverlay(overlay) {
			update({ overlay });
		},
		setSpeed,
		togglePause() {
			setSpeed(snapshot.speed === 0 ? 1 : 0);
		},
		installKeyboard() {
			function onKeyDown(e: KeyboardEvent): void {
				if (
					e.target instanceof HTMLInputElement ||
					e.target instanceof HTMLTextAreaElement
				) {
					return;
				}
				let handled = true;
				switch (e.key) {
					case "1":
						store.toggleTool("zone-r");
						break;
					case "2":
						store.toggleTool("zone-c");
						break;
					case "3":
						store.toggleTool("zone-i");
						break;
					case "r":
					case "R":
						store.toggleTool("road");
						break;
					case "x":
					case "X":
						store.toggleTool("demolish");
						break;
					case "Escape":
						store.setTool("none");
						break;
					case " ":
						store.togglePause();
						break;
					default:
						handled = false;
				}
				if (handled) e.preventDefault();
			}
			window.addEventListener("keydown", onKeyDown);
			return () => {
				window.removeEventListener("keydown", onKeyDown);
			};
		},
	};

	// Push the initial speed to the worker so it matches the UI default.
	sim.setSpeed(snapshot.speed);

	return store;
}
