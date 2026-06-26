import { describe, expect, it } from "vitest";
import { createCity, inBounds, tileIndex } from "./city-state.ts";
import {
	AGG,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	STARTING_TREASURY,
} from "./constants.ts";

describe("CityState", () => {
	it("creates a city with default dimensions", () => {
		const city = createCity();

		expect(city.width).toBe(DEFAULT_WIDTH);
		expect(city.height).toBe(DEFAULT_HEIGHT);
		expect(city.size).toBe(DEFAULT_WIDTH * DEFAULT_HEIGHT);
	});

	it("creates a city with custom dimensions", () => {
		const city = createCity({ width: 16, height: 32 });

		expect(city.width).toBe(16);
		expect(city.height).toBe(32);
		expect(city.size).toBe(512);
	});

	it("initializes all grid layers to zero", () => {
		const city = createCity({ width: 8, height: 8 });

		expect(city.zoning.every((v) => v === 0)).toBe(true);
		expect(city.building.every((v) => v === 0)).toBe(true);
		expect(city.roads.every((v) => v === 0)).toBe(true);
		expect(city.population.every((v) => v === 0)).toBe(true);
		expect(city.jobs.every((v) => v === 0)).toBe(true);
		expect(city.pollution.every((v) => v === 0)).toBe(true);
	});

	it("initializes aggregate state with defaults", () => {
		const city = createCity();

		expect(city.aggregates[AGG.TICK]).toBe(0);
		expect(city.aggregates[AGG.TREASURY]).toBe(STARTING_TREASURY);
		expect(city.aggregates[AGG.TAX_RATE_R]).toBeCloseTo(0.07);
		expect(city.aggregates[AGG.TAX_RATE_C]).toBeCloseTo(0.07);
		expect(city.aggregates[AGG.TAX_RATE_I]).toBeCloseTo(0.07);
		expect(city.aggregates[AGG.R_DEMAND]).toBe(0);
		expect(city.aggregates[AGG.C_DEMAND]).toBe(0);
		expect(city.aggregates[AGG.I_DEMAND]).toBe(0);
	});

	it("throws on invalid dimensions", () => {
		expect(() => createCity({ width: 0, height: 10 })).toThrow();
		expect(() => createCity({ width: 10, height: 0 })).toThrow();
		expect(() => createCity({ width: 300, height: 10 })).toThrow();
	});

	it("produces deterministic PRNG from seed", () => {
		const a = createCity({ seed: 123 });
		const b = createCity({ seed: 123 });

		expect(a.rng.s[0]).toBe(b.rng.s[0]);
		expect(a.rng.s[1]).toBe(b.rng.s[1]);
		expect(a.rng.s[2]).toBe(b.rng.s[2]);
		expect(a.rng.s[3]).toBe(b.rng.s[3]);
	});
});

describe("tileIndex", () => {
	it("computes y * width + x", () => {
		expect(tileIndex(64, 3, 5)).toBe(5 * 64 + 3);
		expect(tileIndex(10, 0, 0)).toBe(0);
		expect(tileIndex(10, 9, 9)).toBe(99);
	});
});

describe("inBounds", () => {
	it("returns true for valid coordinates", () => {
		expect(inBounds(10, 10, 0, 0)).toBe(true);
		expect(inBounds(10, 10, 9, 9)).toBe(true);
		expect(inBounds(10, 10, 5, 5)).toBe(true);
	});

	it("returns false for out-of-bounds coordinates", () => {
		expect(inBounds(10, 10, -1, 0)).toBe(false);
		expect(inBounds(10, 10, 0, -1)).toBe(false);
		expect(inBounds(10, 10, 10, 0)).toBe(false);
		expect(inBounds(10, 10, 0, 10)).toBe(false);
	});
});
