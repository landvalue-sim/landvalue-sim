import { describe, expect, it } from "vitest";
import { createCity } from "./city-state.ts";
import { SEA_LEVEL, TERRAIN_WATER } from "./constants.ts";
import { generateTerrain } from "./terrain-gen.ts";

const W = 64;
const H = 64;

describe("generateTerrain", () => {
	it("is deterministic for a given seed", () => {
		const a = createCity({ width: W, height: H, seed: 1 });
		const b = createCity({ width: W, height: H, seed: 1 });
		generateTerrain(a, 123);
		generateTerrain(b, 123);
		expect(Array.from(a.vertexHeights)).toEqual(Array.from(b.vertexHeights));
		expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
	});

	it("keeps adjacent corner heights within 1 of each other", () => {
		const city = createCity({ width: W, height: H, seed: 1 });
		generateTerrain(city, 123);
		const vw = W + 1;
		const vh = H + 1;
		const heights = city.vertexHeights;
		for (let vy = 0; vy < vh; vy++) {
			for (let vx = 0; vx < vw; vx++) {
				const h = heights[vy * vw + vx] ?? 0;
				if (vx + 1 < vw) {
					expect(Math.abs(h - (heights[vy * vw + vx + 1] ?? 0))).toBeLessThan(
						2,
					);
				}
				if (vy + 1 < vh) {
					expect(Math.abs(h - (heights[(vy + 1) * vw + vx] ?? 0))).toBeLessThan(
						2,
					);
				}
			}
		}
	});

	it("derives per-tile elevation and water from the corners", () => {
		const city = createCity({ width: W, height: H, seed: 1 });
		generateTerrain(city, 123);
		const vw = W + 1;
		const heights = city.vertexHeights;
		let waterTiles = 0;
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const hn = heights[y * vw + x] ?? 0;
				const he = heights[y * vw + x + 1] ?? 0;
				const hs = heights[(y + 1) * vw + x + 1] ?? 0;
				const hw = heights[(y + 1) * vw + x] ?? 0;
				const idx = y * W + x;
				expect(city.elevation[idx]).toBe(Math.min(hn, he, hs, hw));
				if (city.terrain[idx] === TERRAIN_WATER) {
					waterTiles++;
					expect(Math.max(hn, he, hs, hw)).toBeLessThanOrEqual(SEA_LEVEL);
					expect(city.waterLevel[idx]).toBe(SEA_LEVEL);
				} else {
					expect(city.waterLevel[idx]).toBe(0);
				}
			}
		}
		// The default seed should produce some water so the map is interesting.
		expect(waterTiles).toBeGreaterThan(0);
	});
});
