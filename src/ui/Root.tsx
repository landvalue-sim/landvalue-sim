/**
 * Root — owns the app phase: main menu first, then the running game. The sim
 * client (worker + SharedArrayBuffer) is only created once the player starts a
 * city, so the menu carries no simulation cost. A failed start (e.g. missing
 * cross-origin isolation) renders the fatal-error panel instead of the game.
 */

import { useState } from "react";
import { createSimClient, type SimClient } from "../app/sim-client.ts";
import { createStore, type InteractionStore } from "../app/store.ts";
import { App } from "./App.tsx";
import { MainMenu, type NewCityConfig } from "./MainMenu.tsx";

interface Session {
	sim: SimClient;
	store: InteractionStore;
}

export function Root(): React.ReactElement {
	const [session, setSession] = useState<Session | null>(null);
	const [error, setError] = useState<string | null>(null);

	if (error !== null) {
		return (
			<div className="fatal-error">
				<h1>Cannot start simulation</h1>
				<p>{error}</p>
			</div>
		);
	}

	if (session !== null) {
		return <App sim={session.sim} store={session.store} />;
	}

	return (
		<MainMenu
			onStart={(config: NewCityConfig) => {
				try {
					const sim = createSimClient(config);
					setSession({ sim, store: createStore(sim) });
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}}
		/>
	);
}
