/**
 * Entry point — mounts the React root. The Root component owns the app phase:
 * the main menu renders first, and the worker-backed sim client is created
 * only when the player starts a city.
 */

import { createRoot } from "react-dom/client";
import { Root } from "./ui/Root.tsx";
import "./style.css";

const rootEl = document.getElementById("app");
if (rootEl === null) throw new Error("Missing #app element");

createRoot(rootEl).render(<Root />);
