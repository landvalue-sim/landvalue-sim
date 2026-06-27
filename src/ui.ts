/**
 * UI sidebar — DOM construction and live updates for tools, overlays,
 * speed controls, city stats, and demand bars.
 */

import type { CityState } from "./sim/city-state.ts";
import { AGG, MAX_DEMAND } from "./sim/constants.ts";
import type { AppState, OverlayMode, Speed, Tool } from "./types.ts";

// ---- Elements returned for live updates ------------------------------------

export interface UiElements {
	sidebar: HTMLElement;
	popValue: HTMLElement;
	jobsValue: HTMLElement;
	treasuryValue: HTMLElement;
	tickValue: HTMLElement;
	rDemandFill: HTMLElement;
	cDemandFill: HTMLElement;
	iDemandFill: HTMLElement;
}

// ---- Callbacks from UI events ----------------------------------------------

export interface UiCallbacks {
	onToolSelect: (tool: Tool) => void;
	onOverlaySelect: (overlay: OverlayMode) => void;
	onSpeedSelect: (speed: Speed) => void;
}

// ---- Construction ----------------------------------------------------------

export function createUi(
	container: HTMLElement,
	callbacks: UiCallbacks,
): UiElements {
	const sidebar = el("aside", { id: "sidebar" });

	// ---- Tools ----
	sidebar.appendChild(sectionTitle("Tools"));
	const toolDefs: ReadonlyArray<{ tool: Tool; label: string }> = [
		{ tool: "zone-r", label: "Residential (1)" },
		{ tool: "zone-c", label: "Commercial (2)" },
		{ tool: "zone-i", label: "Industrial (3)" },
		{ tool: "road", label: "Road (R)" },
		{ tool: "demolish", label: "Demolish (X)" },
	];
	for (const def of toolDefs) {
		const btn = el("button", {
			className: "tool-btn",
			textContent: def.label,
		});
		btn.setAttribute("data-tool", def.tool);
		btn.addEventListener("click", () => callbacks.onToolSelect(def.tool));
		sidebar.appendChild(btn);
	}

	// ---- Overlays ----
	sidebar.appendChild(sectionTitle("Overlays"));
	const overlayDefs: ReadonlyArray<{
		overlay: OverlayMode;
		label: string;
	}> = [
		{ overlay: "none", label: "None" },
		{ overlay: "land-value", label: "Land Value" },
		{ overlay: "pollution", label: "Pollution" },
	];
	for (const def of overlayDefs) {
		const btn = el("button", {
			className: "overlay-btn",
			textContent: def.label,
		});
		btn.setAttribute("data-overlay", def.overlay);
		btn.addEventListener("click", () => callbacks.onOverlaySelect(def.overlay));
		sidebar.appendChild(btn);
	}

	// ---- Speed ----
	sidebar.appendChild(sectionTitle("Speed"));
	const speedRow = el("div", { className: "speed-row" });
	const speedDefs: ReadonlyArray<{ speed: Speed; label: string }> = [
		{ speed: 0, label: "\u23F8" },
		{ speed: 1, label: "\u25B6" },
		{ speed: 2, label: "\u25B6\u25B6" },
		{ speed: 3, label: "\u25B6\u25B6\u25B6" },
	];
	for (const def of speedDefs) {
		const btn = el("button", {
			className: "speed-btn",
			textContent: def.label,
		});
		btn.setAttribute("data-speed", String(def.speed));
		btn.addEventListener("click", () => callbacks.onSpeedSelect(def.speed));
		speedRow.appendChild(btn);
	}
	sidebar.appendChild(speedRow);

	// ---- Stats ----
	sidebar.appendChild(sectionTitle("City"));
	const popValue = statRow(sidebar, "Population");
	const jobsValue = statRow(sidebar, "Jobs");
	const treasuryValue = statRow(sidebar, "Treasury");
	const tickValue = statRow(sidebar, "Tick");

	// ---- Demand ----
	sidebar.appendChild(sectionTitle("Demand"));
	const rDemandFill = demandRow(sidebar, "R", "r");
	const cDemandFill = demandRow(sidebar, "C", "c");
	const iDemandFill = demandRow(sidebar, "I", "i");

	container.prepend(sidebar);

	return {
		sidebar,
		popValue,
		jobsValue,
		treasuryValue,
		tickValue,
		rDemandFill,
		cDemandFill,
		iDemandFill,
	};
}

// ---- Live updates ----------------------------------------------------------

export function updateUi(
	ui: UiElements,
	city: CityState,
	appState: AppState,
): void {
	const agg = city.aggregates;
	const pop = agg[AGG.TOTAL_POP] ?? 0;
	const cJobs = agg[AGG.TOTAL_C_JOBS] ?? 0;
	const iJobs = agg[AGG.TOTAL_I_JOBS] ?? 0;
	const treasury = agg[AGG.TREASURY] ?? 0;
	const tickNum = agg[AGG.TICK] ?? 0;

	ui.popValue.textContent = Math.floor(pop).toLocaleString();
	ui.jobsValue.textContent = Math.floor(cJobs + iJobs).toLocaleString();
	ui.treasuryValue.textContent = `$${Math.floor(treasury).toLocaleString()}`;
	ui.tickValue.textContent = Math.floor(tickNum).toLocaleString();

	updateDemandBar(ui.rDemandFill, agg[AGG.R_DEMAND] ?? 0, "#22c55e");
	updateDemandBar(ui.cDemandFill, agg[AGG.C_DEMAND] ?? 0, "#3b82f6");
	updateDemandBar(ui.iDemandFill, agg[AGG.I_DEMAND] ?? 0, "#eab308");

	// Active states
	setActive(ui.sidebar, "[data-tool]", "data-tool", appState.tool);
	setActive(ui.sidebar, "[data-overlay]", "data-overlay", appState.overlay);
	setActive(ui.sidebar, "[data-speed]", "data-speed", String(appState.speed));
}

// ---- Helpers ---------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props?: Partial<HTMLElementTagNameMap[K]>,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (props !== undefined) {
		Object.assign(element, props);
	}
	return element;
}

function sectionTitle(text: string): HTMLElement {
	return el("div", { className: "section-title", textContent: text });
}

function statRow(parent: HTMLElement, label: string): HTMLElement {
	const row = el("div", { className: "stat-row" });
	row.appendChild(el("span", { className: "stat-label", textContent: label }));
	const value = el("span", { className: "stat-value", textContent: "0" });
	row.appendChild(value);
	parent.appendChild(row);
	return value;
}

function demandRow(
	parent: HTMLElement,
	letter: string,
	zone: string,
): HTMLElement {
	const row = el("div", { className: "demand-row" });

	const ltr = el("span", {
		className: "demand-letter",
		textContent: letter,
	});
	ltr.setAttribute("data-zone", zone);
	row.appendChild(ltr);

	const track = el("div", { className: "demand-track" });
	track.appendChild(el("div", { className: "demand-center" }));
	const fill = el("div", { className: "demand-fill" });
	track.appendChild(fill);
	row.appendChild(track);

	parent.appendChild(row);
	return fill;
}

function updateDemandBar(
	fill: HTMLElement,
	demand: number,
	color: string,
): void {
	const pct = (Math.abs(demand) / MAX_DEMAND) * 50;

	if (demand >= 0) {
		fill.style.left = "50%";
		fill.style.width = `${pct}%`;
		fill.style.backgroundColor = color;
	} else {
		fill.style.left = `${50 - pct}%`;
		fill.style.width = `${pct}%`;
		fill.style.backgroundColor = "#ef4444";
	}
}

function setActive(
	container: HTMLElement,
	selector: string,
	attr: string,
	value: string,
): void {
	for (const btn of container.querySelectorAll(selector)) {
		btn.classList.toggle("active", btn.getAttribute(attr) === value);
	}
}
