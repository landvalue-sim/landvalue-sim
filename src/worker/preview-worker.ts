/**
 * Terrain-preview worker — runs the real terrain generator off the main
 * thread for the New City screen, so the menu stays responsive while a
 * preview builds. Each request creates a throwaway city in a private
 * ArrayBuffer (cold path — no SharedArrayBuffer, no tick loop), generates
 * terrain with the requested seed, and posts back painted RGBA pixels with
 * the buffer transferred rather than copied.
 */

/// <reference lib="webworker" />

import type {
	FromPreviewWorkerMessage,
	ToPreviewWorkerMessage,
} from "../app/preview-protocol.ts";
import { createCity, generateTerrain } from "../sim/index.ts";
import { paintPreviewPixels } from "./preview-paint.ts";

const ctx = self as DedicatedWorkerGlobalScope;

ctx.addEventListener(
	"message",
	(event: MessageEvent<ToPreviewWorkerMessage>) => {
		const msg = event.data;
		if (msg.type !== "preview") return;

		const { id, size, seed } = msg;
		const city = createCity({ width: size, height: size, seed });
		generateTerrain(city, seed);

		const pixels = new Uint8ClampedArray(size * size * 4);
		paintPreviewPixels(city, pixels);

		const result: FromPreviewWorkerMessage = {
			type: "preview-result",
			id,
			size,
			pixels: pixels.buffer,
		};
		ctx.postMessage(result, [pixels.buffer]);
	},
);
