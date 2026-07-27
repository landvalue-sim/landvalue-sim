/**
 * Phaser game bootstrap — a thin shell. Creates the WebGL/Canvas game, mounts
 * it into the provided parent element, and runs the single `IsoScene`. Sizing
 * tracks the parent via Phaser's RESIZE scale mode.
 */

import Phaser from "phaser";
import { IsoScene, type SceneDeps } from "./iso-scene.ts";

export function createGame(parent: HTMLElement, deps: SceneDeps): Phaser.Game {
	const scene = new IsoScene(deps);
	const game = new Phaser.Game({
		type: Phaser.AUTO,
		parent,
		backgroundColor: "#0f172a",
		scale: {
			mode: Phaser.Scale.RESIZE,
			width: parent.clientWidth || 800,
			height: parent.clientHeight || 600,
		},
		render: {
			antialias: true,
			powerPreference: "high-performance",
		},
		scene,
	});
	// Dev-only handle for poking the game from the browser console.
	if (import.meta.env.DEV) {
		Reflect.set(window, "__game", game);
	}
	return game;
}
