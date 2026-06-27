/**
 * Dev stats panel — collapsible overlay showing tick profiling data
 * and invariant violations. Only rendered in dev mode.
 */

import {
	clearViolations,
	getProfileSnapshot,
	getViolations,
	type ProfileSnapshot,
	SYSTEM_NAMES,
} from "./sim/index.ts";

// ---- Types ------------------------------------------------------------------

export interface DevPanelElements {
	container: HTMLElement;
	systemRows: Map<string, HTMLElement>;
	totalRow: HTMLElement;
	violationList: HTMLElement;
	violationCount: HTMLElement;
}

// ---- Construction -----------------------------------------------------------

export function createDevPanel(parent: HTMLElement): DevPanelElements | null {
	if (!import.meta.env.DEV) return null;

	const container = document.createElement("details");
	container.id = "dev-panel";
	container.open = true;

	const summary = document.createElement("summary");
	summary.className = "dev-panel-title";
	summary.textContent = "Dev Stats";
	container.appendChild(summary);

	// ---- Profiler section ----
	const profilerHeader = document.createElement("div");
	profilerHeader.className = "dev-section-title";
	profilerHeader.textContent = "Tick Profiler (ms)";
	container.appendChild(profilerHeader);

	const table = document.createElement("div");
	table.className = "dev-table";
	container.appendChild(table);

	// Header row
	const header = document.createElement("div");
	header.className = "dev-row dev-header";
	header.innerHTML =
		"<span>System</span><span>Last</span><span>Avg</span><span>Max</span>";
	table.appendChild(header);

	// System rows
	const systemRows = new Map<string, HTMLElement>();
	for (const name of SYSTEM_NAMES) {
		const row = document.createElement("div");
		row.className = "dev-row";
		row.innerHTML = `<span class="dev-name">${name}</span><span>—</span><span>—</span><span>—</span>`;
		table.appendChild(row);
		systemRows.set(name, row);
	}

	// Total row
	const totalRow = document.createElement("div");
	totalRow.className = "dev-row dev-total";
	totalRow.innerHTML =
		'<span class="dev-name">total</span><span>—</span><span>—</span><span>—</span>';
	table.appendChild(totalRow);

	// ---- Violations section ----
	const violationHeader = document.createElement("div");
	violationHeader.className = "dev-section-title";
	const violationCount = document.createElement("span");
	violationCount.className = "dev-violation-count";
	violationCount.textContent = "0";
	violationHeader.textContent = "Violations ";
	violationHeader.appendChild(violationCount);

	const clearBtn = document.createElement("button");
	clearBtn.className = "dev-clear-btn";
	clearBtn.textContent = "Clear";
	clearBtn.addEventListener("click", () => {
		clearViolations();
	});
	violationHeader.appendChild(clearBtn);
	container.appendChild(violationHeader);

	const violationList = document.createElement("div");
	violationList.className = "dev-violations";
	container.appendChild(violationList);

	parent.appendChild(container);

	return { container, systemRows, totalRow, violationList, violationCount };
}

// ---- Live update ------------------------------------------------------------

const UPDATE_INTERVAL = 10; // update every N frames to avoid DOM thrash
let frameCounter = 0;

export function updateDevPanel(panel: DevPanelElements | null): void {
	if (panel === null) return;
	if (!import.meta.env.DEV) return;

	frameCounter++;
	if (frameCounter % UPDATE_INTERVAL !== 0) return;

	const snapshot = getProfileSnapshot();
	updateProfilerRows(panel, snapshot);
	updateViolations(panel);
}

function updateProfilerRows(
	panel: DevPanelElements,
	snapshot: ProfileSnapshot,
): void {
	for (const [name, stats] of snapshot.systems) {
		const row = panel.systemRows.get(name);
		if (row === undefined) continue;

		const spans = row.querySelectorAll("span");
		if (spans.length >= 4) {
			const lastSpan = spans[1];
			const avgSpan = spans[2];
			const maxSpan = spans[3];
			if (lastSpan !== undefined) lastSpan.textContent = fmt(stats.last);
			if (avgSpan !== undefined) avgSpan.textContent = fmt(stats.avg);
			if (maxSpan !== undefined) maxSpan.textContent = fmt(stats.max);
		}
	}

	const totalSpans = panel.totalRow.querySelectorAll("span");
	if (totalSpans.length >= 4) {
		const s = snapshot.totalTick;
		const lastSpan = totalSpans[1];
		const avgSpan = totalSpans[2];
		const maxSpan = totalSpans[3];
		if (lastSpan !== undefined) lastSpan.textContent = fmt(s.last);
		if (avgSpan !== undefined) avgSpan.textContent = fmt(s.avg);
		if (maxSpan !== undefined) maxSpan.textContent = fmt(s.max);
	}
}

function updateViolations(panel: DevPanelElements): void {
	const violations = getViolations();
	panel.violationCount.textContent = String(violations.length);

	if (violations.length > 0) {
		panel.violationCount.classList.add("has-violations");
	} else {
		panel.violationCount.classList.remove("has-violations");
	}

	// Only rebuild DOM if count changed
	if (panel.violationList.childElementCount !== violations.length) {
		panel.violationList.textContent = "";
		const limit = Math.min(violations.length, 20);
		for (let i = 0; i < limit; i++) {
			const v = violations[i];
			if (v === undefined) continue;
			const line = document.createElement("div");
			line.className = "dev-violation";
			line.textContent = `[t${v.tick}] ${v.system}: ${v.message}`;
			panel.violationList.appendChild(line);
		}
		if (violations.length > 20) {
			const more = document.createElement("div");
			more.className = "dev-violation dev-more";
			more.textContent = `… and ${violations.length - 20} more`;
			panel.violationList.appendChild(more);
		}
	}
}

function fmt(ms: number): string {
	if (ms < 0.01) return "0.00";
	if (ms < 1) return ms.toFixed(2);
	return ms.toFixed(1);
}
