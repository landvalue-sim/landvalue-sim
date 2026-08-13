import { describe, expect, it } from "vitest";
import { parseRoute, parseSeedText, routeHash } from "./router.ts";

describe("parseRoute", () => {
	it("routes the empty and root hashes to the menu", () => {
		expect(parseRoute("")).toEqual({ page: "menu" });
		expect(parseRoute("#/")).toEqual({ page: "menu" });
		expect(parseRoute("#/nonsense")).toEqual({ page: "menu" });
	});

	it("parses the new-city page with and without params", () => {
		expect(parseRoute("#/new")).toEqual({
			page: "new-city",
			size: null,
			seed: null,
		});
		expect(parseRoute("#/new?size=128&seed=42")).toEqual({
			page: "new-city",
			size: 128,
			seed: 42,
		});
	});

	it("parses a well-formed game route", () => {
		expect(parseRoute("#/game?size=256&seed=901")).toEqual({
			page: "game",
			size: 256,
			seed: 901,
		});
	});

	it("falls back to the menu for malformed game params", () => {
		expect(parseRoute("#/game")).toEqual({ page: "menu" });
		expect(parseRoute("#/game?size=128")).toEqual({ page: "menu" });
		expect(parseRoute("#/game?size=0&seed=1")).toEqual({ page: "menu" });
		expect(parseRoute("#/game?size=999&seed=1")).toEqual({ page: "menu" });
		expect(parseRoute("#/game?size=abc&seed=1")).toEqual({ page: "menu" });
		expect(parseRoute("#/game?size=128&seed=-5")).toEqual({ page: "menu" });
	});

	it("round-trips every route through routeHash", () => {
		const routes = [
			{ page: "menu" },
			{ page: "new-city", size: null, seed: null },
			{ page: "new-city", size: 64, seed: 7 },
			{ page: "game", size: 128, seed: 42 },
		] as const;
		for (const route of routes) {
			expect(parseRoute(routeHash(route))).toEqual(route);
		}
	});
});

describe("parseSeedText", () => {
	it("accepts 1-9 digit non-negative integers", () => {
		expect(parseSeedText("0")).toBe(0);
		expect(parseSeedText(" 42 ")).toBe(42);
		expect(parseSeedText("999999999")).toBe(999999999);
	});

	it("rejects everything else", () => {
		expect(parseSeedText("")).toBeNull();
		expect(parseSeedText("-1")).toBeNull();
		expect(parseSeedText("1234567890")).toBeNull();
		expect(parseSeedText("1.5")).toBeNull();
		expect(parseSeedText("seed")).toBeNull();
	});
});
