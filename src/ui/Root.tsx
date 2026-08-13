/**
 * Root — top-level page switch driven by the hash router (see app/router.ts).
 * Each page owns its own resources: the sim client only exists while the game
 * page is mounted, so the menu carries no simulation cost and a dev reload
 * lands back on the page being worked on.
 */

import { useSyncExternalStore } from "react";
import { parseRoute } from "../app/router.ts";
import { GamePage } from "./GamePage.tsx";
import { MainMenuPage, NewCityPage } from "./MainMenu.tsx";

function subscribeHash(onChange: () => void): () => void {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): string {
	return window.location.hash;
}

export function Root(): React.ReactElement {
	const hash = useSyncExternalStore(subscribeHash, readHash);
	const route = parseRoute(hash);

	if (route.page === "game") {
		return <GamePage size={route.size} seed={route.seed} />;
	}
	if (route.page === "new-city") {
		return <NewCityPage initialSize={route.size} initialSeed={route.seed} />;
	}
	return <MainMenuPage />;
}
