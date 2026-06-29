/**
 * Entry point — wires the worker-backed sim client and the interaction store,
 * then mounts the React app. If the page is not cross-origin isolated (no
 * SharedArrayBuffer), it renders an actionable error instead of a blank page.
 */

import { createRoot } from "react-dom/client";
import { createSimClient } from "./app/sim-client.ts";
import { createStore } from "./app/store.ts";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from "./sim/index.ts";
import { App } from "./ui/App.tsx";
import "./style.css";

const root = document.getElementById("app");
if (root === null) throw new Error("Missing #app element");

try {
	const sim = createSimClient({
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT,
		seed: 42,
	});
	const store = createStore(sim);

	createRoot(root).render(<App sim={sim} store={store} />);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	const panel = document.createElement("div");
	panel.className = "fatal-error";
	panel.innerHTML = `<h1>Cannot start simulation</h1><p></p>`;
	const p = panel.querySelector("p");
	if (p !== null) p.textContent = message;
	root.appendChild(panel);
}
