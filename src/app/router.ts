/**
 * Hash router — the app's pages live at distinct URLs so a dev reload (or a
 * bookmark) lands back on the page being worked on instead of the main menu:
 *
 *   #/                        main menu
 *   #/new?size=128&seed=42    new-city setup (params optional, kept in sync)
 *   #/game?size=128&seed=42   running game (params required; malformed
 *                             routes fall back to the menu)
 *
 * The game page carries its whole config in the URL, so reloading mid-game
 * re-founds the identical city — the terrain generator is deterministic in
 * (size, seed). Hash routing needs no server-side fallback configuration.
 */

import { MAX_GRID_SIZE } from "../sim/index.ts";

export type Route =
	| { page: "menu" }
	| { page: "new-city"; size: number | null; seed: number | null }
	| { page: "game"; size: number; seed: number };

/** Seeds are non-negative decimal integers; 9 digits keeps them in 32 bits. */
const SEED_PATTERN = /^\d{1,9}$/;

/** Parse a seed as typed by the player or carried in the URL. */
export function parseSeedText(text: string): number | null {
	const trimmed = text.trim();
	if (!SEED_PATTERN.test(trimmed)) return null;
	return Number(trimmed);
}

function parseSizeParam(value: string | null): number | null {
	if (value === null || !/^\d{1,3}$/.test(value)) return null;
	const size = Number(value);
	if (size < 1 || size > MAX_GRID_SIZE) return null;
	return size;
}

function parseSeedParam(value: string | null): number | null {
	if (value === null) return null;
	return parseSeedText(value);
}

/** Parse `location.hash` (leading `#` optional) into a route. */
export function parseRoute(hash: string): Route {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash;
	const queryStart = raw.indexOf("?");
	const path = queryStart === -1 ? raw : raw.slice(0, queryStart);
	const query = queryStart === -1 ? "" : raw.slice(queryStart + 1);
	const params = new URLSearchParams(query);

	if (path === "/new") {
		return {
			page: "new-city",
			size: parseSizeParam(params.get("size")),
			seed: parseSeedParam(params.get("seed")),
		};
	}
	if (path === "/game") {
		const size = parseSizeParam(params.get("size"));
		const seed = parseSeedParam(params.get("seed"));
		if (size !== null && seed !== null) return { page: "game", size, seed };
		return { page: "menu" };
	}
	return { page: "menu" };
}

export function routeHash(route: Route): string {
	if (route.page === "game") {
		return `#/game?size=${route.size}&seed=${route.seed}`;
	}
	if (route.page === "new-city") {
		if (route.size === null || route.seed === null) return "#/new";
		return `#/new?size=${route.size}&seed=${route.seed}`;
	}
	return "#/";
}

/** Navigate to a route, pushing a history entry (back button works). */
export function navigate(route: Route): void {
	window.location.hash = routeHash(route);
}

/**
 * Rewrite the current URL without a history entry or a hashchange event —
 * used to keep form state (size/seed) reload-safe while the player edits it.
 */
export function replaceRoute(route: Route): void {
	window.history.replaceState(null, "", routeHash(route));
}
