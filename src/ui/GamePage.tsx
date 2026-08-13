/**
 * GamePage — boots a sim session for the size/seed carried in the URL and
 * mounts the game. The synchronous city build (SAB alloc + terrain gen +
 * worker spawn) is deferred one frame behind a loading cover so the cover
 * paints before the main thread blocks. Leaving the page (or changing the
 * config) disposes the session, terminating the sim worker.
 */

import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { navigate } from "../app/router.ts";
import { createSimClient, type SimClient } from "../app/sim-client.ts";
import { createStore, type InteractionStore } from "../app/store.ts";
import { App } from "./App.tsx";

interface Session {
	sim: SimClient;
	store: InteractionStore;
}

export function GamePage({
	size,
	seed,
}: {
	size: number;
	seed: number;
}): React.ReactElement {
	const [session, setSession] = useState<Session | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let sim: SimClient | null = null;
		let timer = 0;
		const raf = requestAnimationFrame(() => {
			timer = window.setTimeout(() => {
				try {
					sim = createSimClient({ width: size, height: size, seed });
					setSession({ sim, store: createStore(sim) });
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}, 0);
		});
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(timer);
			if (sim !== null) sim.dispose();
			setSession(null);
		};
	}, [size, seed]);

	if (error !== null) {
		return (
			<div className="fatal-error">
				<h1>Cannot start simulation</h1>
				<p>{error}</p>
				<Button className="menu-btn" onPress={() => navigate({ page: "menu" })}>
					Back to menu
				</Button>
			</div>
		);
	}

	if (session === null) {
		return (
			<div className="game-loading">
				<div className="spinner" />
				<span>Founding city…</span>
			</div>
		);
	}

	return <App sim={session.sim} store={session.store} />;
}
