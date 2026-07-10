/**
 * Object pool for Phaser Image game objects used to render tile sprites.
 *
 * Frame lifecycle: begin() resets the allocation cursor, place() activates
 * images from the pool, end() hides unused images. This avoids per-frame
 * object creation — the pool grows only when more sprites are visible than
 * the current capacity.
 */

import type Phaser from "phaser";

const INITIAL_POOL_SIZE = 256;
const POOL_GROW_SIZE = 64;

export class SpritePool {
	private readonly scene: Phaser.Scene;
	private readonly blankKey: string;
	private readonly pool: Phaser.GameObjects.Image[] = [];
	private cursor = 0;

	constructor(scene: Phaser.Scene, blankKey: string) {
		this.scene = scene;
		this.blankKey = blankKey;
		this.grow(INITIAL_POOL_SIZE);
	}

	/** Reset the allocation cursor. Call at the start of each frame. */
	begin(): void {
		this.cursor = 0;
	}

	/** Activate a pooled image with the given texture, position, and depth. */
	place(
		textureKey: string,
		frame: string | number | undefined,
		screenX: number,
		screenY: number,
		depth: number,
		originX: number,
		originY: number,
	): Phaser.GameObjects.Image {
		if (this.cursor >= this.pool.length) {
			this.grow(POOL_GROW_SIZE);
		}
		const img = this.pool[this.cursor];
		if (img === undefined) {
			throw new Error("SpritePool: unexpected empty slot");
		}
		this.cursor += 1;
		img.setTexture(textureKey, frame);
		img.setPosition(screenX, screenY);
		img.setOrigin(originX, originY);
		img.setDepth(depth);
		img.setVisible(true);
		img.setActive(true);
		return img;
	}

	/** Hide all images beyond the cursor. Call at the end of each frame. */
	end(): void {
		for (let i = this.cursor; i < this.pool.length; i++) {
			const img = this.pool[i];
			if (img === undefined || !img.visible) break;
			img.setVisible(false);
			img.setActive(false);
		}
	}

	private grow(count: number): void {
		for (let i = 0; i < count; i++) {
			const img = this.scene.add.image(0, 0, this.blankKey);
			img.setVisible(false);
			img.setActive(false);
			this.pool.push(img);
		}
	}
}
