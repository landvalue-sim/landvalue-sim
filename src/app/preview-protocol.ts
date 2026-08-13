/**
 * Message contract between the main thread and the terrain-preview worker.
 * One request kind, one response kind; requests are correlated by `id` so the
 * client can discard answers to superseded requests.
 */

export interface PreviewRequestMessage {
	type: "preview";
	id: number;
	/** Map side length in tiles (maps are square). */
	size: number;
	seed: number;
}

export interface PreviewResultMessage {
	type: "preview-result";
	id: number;
	size: number;
	/** RGBA pixels, `size * size * 4` bytes, transferred (not copied). */
	pixels: ArrayBuffer;
}

export type ToPreviewWorkerMessage = PreviewRequestMessage;
export type FromPreviewWorkerMessage = PreviewResultMessage;
