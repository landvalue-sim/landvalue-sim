import { describe, expect, it } from "vitest";
import { createCity, generateTerrain, TERRAIN_WATER } from "../sim/index.ts";
import { paintPreviewPixels } from "./preview-paint.ts";

function paintedCity(size: number, seed: number): Uint8ClampedArray {
	const city = createCity({ width: size, height: size, seed });
	generateTerrain(city, seed);
	const out = new Uint8ClampedArray(city.size * 4);
	paintPreviewPixels(city, out);
	return out;
}

describe("paintPreviewPixels", () => {
	it("paints every water tile blue-dominant and every land tile not", () => {
		const size = 64;
		const seed = 42;
		const city = createCity({ width: size, height: size, seed });
		generateTerrain(city, seed);
		const out = new Uint8ClampedArray(city.size * 4);
		paintPreviewPixels(city, out);

		let waterTiles = 0;
		let blueDominant = 0;
		let opaque = 0;
		for (let i = 0; i < city.size; i++) {
			if ((city.terrain[i] ?? 0) === TERRAIN_WATER) waterTiles++;
			const r = out[i * 4] ?? 0;
			const g = out[i * 4 + 1] ?? 0;
			const b = out[i * 4 + 2] ?? 0;
			if (b > r && b > g) blueDominant++;
			if ((out[i * 4 + 3] ?? 0) === 255) opaque++;
		}

		// Terrain gen targets ~35% water, so a healthy band must be blue.
		expect(waterTiles).toBeGreaterThan(0);
		expect(blueDominant).toBe(waterTiles);
		expect(opaque).toBe(city.size);
	});

	it("is deterministic for a fixed size and seed", () => {
		const a = paintedCity(64, 1234);
		const b = paintedCity(64, 1234);
		expect(a).toEqual(b);
	});

	it("differs across seeds", () => {
		const a = paintedCity(64, 1);
		const b = paintedCity(64, 2);
		expect(a).not.toEqual(b);
	});
});
