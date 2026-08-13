/**
 * PreviewClient — the main thread's handle to the terrain-preview worker.
 * Latest request wins: issuing a new request immediately resolves any
 * in-flight one with `null`, and stale worker answers are dropped, so the UI
 * only ever paints the newest preview.
 */

import type {
	FromPreviewWorkerMessage,
	ToPreviewWorkerMessage,
} from "./preview-protocol.ts";

export interface PreviewBitmap {
	readonly size: number;
	/** RGBA pixels, `size * size * 4` bytes, row-major. */
	readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

export interface PreviewClient {
	/**
	 * Generate a terrain preview. Resolves `null` when superseded by a newer
	 * request or when the client is disposed.
	 */
	request(size: number, seed: number): Promise<PreviewBitmap | null>;
	dispose(): void;
}

export function createPreviewClient(): PreviewClient {
	const worker = new Worker(
		new URL("../worker/preview-worker.ts", import.meta.url),
		{ type: "module", name: "preview-worker" },
	);

	let nextId = 1;
	let latestId = 0;
	let disposed = false;
	let pendingResolve: ((result: PreviewBitmap | null) => void) | null = null;

	function supersede(): void {
		if (pendingResolve === null) return;
		const resolve = pendingResolve;
		pendingResolve = null;
		resolve(null);
	}

	worker.addEventListener(
		"message",
		(event: MessageEvent<FromPreviewWorkerMessage>) => {
			const msg = event.data;
			if (msg.type !== "preview-result") return;
			if (msg.id !== latestId || pendingResolve === null) return;
			const resolve = pendingResolve;
			pendingResolve = null;
			resolve({ size: msg.size, pixels: new Uint8ClampedArray(msg.pixels) });
		},
	);

	return {
		request(size, seed) {
			if (disposed) return Promise.resolve(null);
			supersede();
			const id = nextId;
			nextId++;
			latestId = id;
			return new Promise((resolve) => {
				pendingResolve = resolve;
				const msg: ToPreviewWorkerMessage = { type: "preview", id, size, seed };
				worker.postMessage(msg);
			});
		},
		dispose() {
			disposed = true;
			supersede();
			worker.terminate();
		},
	};
}
