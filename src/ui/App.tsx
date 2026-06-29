/**
 * App — the main-thread composition root. Renders the accessible DOM UI
 * (Sidebar) alongside the Phaser viewport, mounts the render shell into that
 * viewport, and installs global keyboard shortcuts. The sim itself runs in the
 * worker; this component never touches the tick loop.
 */

import { useEffect, useRef } from "react";
import type { SimClient } from "../app/sim-client.ts";
import type { InteractionStore } from "../app/store.ts";
import { createGame } from "../render/game.ts";
import { Sidebar } from "./Sidebar.tsx";

interface AppProps {
	sim: SimClient;
	store: InteractionStore;
}

export function App({ sim, store }: AppProps): React.ReactElement {
	const viewportRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const parent = viewportRef.current;
		if (parent === null) return;

		const game = createGame(parent, {
			city: sim.city,
			store,
			sendCommands: (cmds) => sim.sendCommands(cmds),
		});
		const removeKeys = store.installKeyboard();

		return () => {
			removeKeys();
			game.destroy(true);
		};
	}, [sim, store]);

	return (
		<>
			<Sidebar store={store} sim={sim} />
			<main id="viewport" ref={viewportRef} />
		</>
	);
}
