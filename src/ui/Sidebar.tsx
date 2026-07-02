/**
 * Sidebar — accessible tool/overlay/speed controls plus live city stats and
 * RCI demand bars. Built on React Aria Components so keyboard navigation and
 * screen-reader semantics come for free (DESIGN.md accessibility goal).
 */

import {
	type Key,
	type PressEvent,
	Switch,
	ToggleButton,
	ToggleButtonGroup,
} from "react-aria-components";
import type { SimClient } from "../app/sim-client.ts";
import type { InteractionStore } from "../app/store.ts";
import type { OverlayMode, Speed, Tool } from "../app/types.ts";
import { MAX_DEMAND } from "../sim/index.ts";
import { DevPanel } from "./DevPanel.tsx";
import { FinancesDialog } from "./FinancesDialog.tsx";
import { formatDate, useInteraction, useLiveStats } from "./hooks.ts";

// ---- Tool definitions -------------------------------------------------------

const TERRAIN_TOOLS: ReadonlyArray<{
	id: Tool;
	label: string;
	accent: string;
}> = [
	{ id: "terraform-raise", label: "Raise Land", accent: "#a16207" },
	{ id: "terraform-lower", label: "Lower Land", accent: "#78350f" },
	{ id: "water", label: "Water", accent: "#2563eb" },
	{ id: "drain", label: "Drain", accent: "#0ea5e9" },
];

const ZONE_TOOLS: ReadonlyArray<{ id: Tool; label: string; accent: string }> = [
	{ id: "zone-r-low", label: "R Low (1)", accent: "#22c55e" },
	{ id: "zone-r-med", label: "R Med (2)", accent: "#16a34a" },
	{ id: "zone-r-high", label: "R High (3)", accent: "#15803d" },
	{ id: "zone-c-low", label: "C Low (4)", accent: "#60a5fa" },
	{ id: "zone-c-med", label: "C Med (5)", accent: "#3b82f6" },
	{ id: "zone-c-high", label: "C High (6)", accent: "#2563eb" },
	{ id: "zone-i-low", label: "I Low (7)", accent: "#facc15" },
	{ id: "zone-i-med", label: "I Med (8)", accent: "#eab308" },
	{ id: "zone-i-high", label: "I High (9)", accent: "#ca8a04" },
];

const INFRA_TOOLS: ReadonlyArray<{ id: Tool; label: string; accent: string }> =
	[
		{ id: "road", label: "Road (R)", accent: "#6b7280" },
		{ id: "rail", label: "Rail (T)", accent: "#71717a" },
		{ id: "power-line", label: "Power Line (P)", accent: "#fbbf24" },
	];

const CIVIC_TOOLS: ReadonlyArray<{ id: Tool; label: string; accent: string }> =
	[
		{ id: "coal-plant", label: "Coal Plant", accent: "#78350f" },
		{ id: "solar-plant", label: "Solar Plant", accent: "#fde047" },
		{ id: "water-pump", label: "Water Pump", accent: "#38bdf8" },
	];

const SERVICE_TOOLS: ReadonlyArray<{
	id: Tool;
	label: string;
	accent: string;
}> = [
	{ id: "police", label: "Police", accent: "#1d4ed8" },
	{ id: "fire-station", label: "Fire Stn", accent: "#dc2626" },
	{ id: "hospital", label: "Hospital", accent: "#f472b6" },
	{ id: "school", label: "School", accent: "#fbbf24" },
	{ id: "college", label: "College", accent: "#7c3aed" },
	{ id: "library", label: "Library", accent: "#ea580c" },
	{ id: "park", label: "Park", accent: "#4ade80" },
	{ id: "stadium", label: "Stadium", accent: "#9ca3af" },
];

const DEMOLISH_TOOL: ReadonlyArray<{
	id: Tool;
	label: string;
	accent: string;
}> = [{ id: "demolish", label: "Demolish (X)", accent: "#ef4444" }];

const OVERLAYS: ReadonlyArray<{ id: OverlayMode; label: string }> = [
	{ id: "none", label: "None" },
	{ id: "land-value", label: "Land Value" },
	{ id: "pollution", label: "Pollution" },
	{ id: "power", label: "Power" },
	{ id: "water", label: "Water" },
	{ id: "crime", label: "Crime" },
	{ id: "traffic", label: "Traffic" },
	{ id: "police", label: "Police" },
	{ id: "fire", label: "Fire" },
	{ id: "education", label: "Education" },
	{ id: "health", label: "Health" },
];

const SPEEDS: ReadonlyArray<{ id: Speed; label: string; aria: string }> = [
	{ id: 0, label: "\u23F8", aria: "Pause" },
	{ id: 1, label: "\u25B6", aria: "Normal speed" },
	{ id: 2, label: "\u25B6\u25B6", aria: "Fast" },
	{ id: 3, label: "\u25B6\u25B6\u25B6", aria: "Fastest" },
];

interface SidebarProps {
	store: InteractionStore;
	sim: SimClient;
}

export function Sidebar({ store, sim }: SidebarProps): React.ReactElement {
	const { tool, overlay, speed, dragEnabled } = useInteraction(store);
	const stats = useLiveStats(sim.city);

	function firstKey(keys: Set<Key>): string | null {
		for (const k of keys) return String(k);
		return null;
	}

	function onToolChange(keys: Set<Key>): void {
		const k = firstKey(keys);
		store.setTool((k as Tool | null) ?? "none");
	}

	return (
		<aside id="sidebar">
			<section>
				<div className="section-title">Terrain</div>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={TERRAIN_TOOLS.some((t) => t.id === tool) ? [tool] : []}
					onSelectionChange={onToolChange}
				>
					{TERRAIN_TOOLS.map((t) => (
						<ToggleButton
							key={t.id}
							id={t.id}
							className="tool-btn"
							style={{ borderLeftColor: t.accent }}
							onPress={blurOnPointerPress}
						>
							{t.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<div className="section-title">Zoning</div>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={tool.startsWith("zone-") ? [tool] : []}
					onSelectionChange={onToolChange}
				>
					{ZONE_TOOLS.map((t) => (
						<ToggleButton
							key={t.id}
							id={t.id}
							className="tool-btn"
							style={{ borderLeftColor: t.accent }}
							onPress={blurOnPointerPress}
						>
							{t.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<div className="section-title">Infrastructure</div>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={
						tool === "road" || tool === "rail" || tool === "power-line"
							? [tool]
							: []
					}
					onSelectionChange={onToolChange}
				>
					{INFRA_TOOLS.map((t) => (
						<ToggleButton
							key={t.id}
							id={t.id}
							className="tool-btn"
							style={{ borderLeftColor: t.accent }}
							onPress={blurOnPointerPress}
						>
							{t.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<div className="section-title">Utilities</div>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={
						tool === "coal-plant" ||
						tool === "solar-plant" ||
						tool === "water-pump"
							? [tool]
							: []
					}
					onSelectionChange={onToolChange}
				>
					{CIVIC_TOOLS.map((t) => (
						<ToggleButton
							key={t.id}
							id={t.id}
							className="tool-btn"
							style={{ borderLeftColor: t.accent }}
							onPress={blurOnPointerPress}
						>
							{t.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<div className="section-title">Services</div>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={SERVICE_TOOLS.some((t) => t.id === tool) ? [tool] : []}
					onSelectionChange={onToolChange}
				>
					{SERVICE_TOOLS.map((t) => (
						<ToggleButton
							key={t.id}
							id={t.id}
							className="tool-btn"
							style={{ borderLeftColor: t.accent }}
							onPress={blurOnPointerPress}
						>
							{t.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={tool === "demolish" ? [tool] : []}
					onSelectionChange={onToolChange}
				>
					{DEMOLISH_TOOL.map((t) => (
						<ToggleButton
							key={t.id}
							id={t.id}
							className="tool-btn"
							style={{ borderLeftColor: t.accent }}
							onPress={blurOnPointerPress}
						>
							{t.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
				<Switch
					className="drag-switch"
					isSelected={dragEnabled}
					onChange={store.setDragEnabled}
				>
					<span className="switch-track">
						<span className="switch-thumb" />
					</span>
					Click &amp; drag
				</Switch>
			</section>

			<section>
				<div className="section-title">Overlays</div>
				<ToggleButtonGroup
					selectionMode="single"
					disallowEmptySelection
					className="btn-stack"
					selectedKeys={[overlay]}
					onSelectionChange={(keys) => {
						const k = firstKey(keys);
						if (k !== null) store.setOverlay(k as OverlayMode);
					}}
				>
					{OVERLAYS.map((o) => (
						<ToggleButton
							key={o.id}
							id={o.id}
							className="overlay-btn"
							onPress={blurOnPointerPress}
						>
							{o.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<div className="section-title">Speed</div>
				<ToggleButtonGroup
					selectionMode="single"
					disallowEmptySelection
					className="speed-row"
					selectedKeys={[String(speed)]}
					onSelectionChange={(keys) => {
						const k = firstKey(keys);
						if (k !== null) store.setSpeed(Number(k) as Speed);
					}}
				>
					{SPEEDS.map((s) => (
						<ToggleButton
							key={s.id}
							id={String(s.id)}
							className="speed-btn"
							aria-label={s.aria}
							onPress={blurOnPointerPress}
						>
							{s.label}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</section>

			<section>
				<div className="section-title">City</div>
				<StatRow label="Date" value={formatDate(stats.month, stats.year)} />
				<StatRow label="Population" value={fmtInt(stats.pop)} />
				<StatRow label="Jobs" value={fmtInt(stats.jobs)} />
				<StatRow label="Treasury" value={fmtMoney(stats.treasury)} />
				<FinancesDialog sim={sim} />
			</section>

			<section>
				<div className="section-title">Demand</div>
				<DemandBar letter="R" zone="r" value={stats.rDemand} color="#22c55e" />
				<DemandBar letter="C" zone="c" value={stats.cDemand} color="#3b82f6" />
				<DemandBar letter="I" zone="i" value={stats.iDemand} color="#eab308" />
			</section>

			<DevPanel sim={sim} />
		</aside>
	);
}

function StatRow({
	label,
	value,
}: {
	label: string;
	value: string;
}): React.ReactElement {
	return (
		<div className="stat-row">
			<span className="stat-label">{label}</span>
			<span className="stat-value">{value}</span>
		</div>
	);
}

function DemandBar({
	letter,
	zone,
	value,
	color,
}: {
	letter: string;
	zone: string;
	value: number;
	color: string;
}): React.ReactElement {
	const pct = (Math.min(Math.abs(value), MAX_DEMAND) / MAX_DEMAND) * 50;
	const positive = value >= 0;
	const fillStyle: React.CSSProperties = positive
		? { left: "50%", width: `${pct}%`, backgroundColor: color }
		: { left: `${50 - pct}%`, width: `${pct}%`, backgroundColor: "#ef4444" };

	return (
		<div className="demand-row">
			<span className="demand-letter" data-zone={zone}>
				{letter}
			</span>
			{/* biome-ignore lint/a11y/useSemanticElements: native <meter> can't render
			    a center-origin bidirectional (surplus/deficit) demand bar. */}
			<div
				className="demand-track"
				role="meter"
				aria-valuenow={Math.round(value)}
				aria-valuemin={-MAX_DEMAND}
				aria-valuemax={MAX_DEMAND}
				aria-label={`${letter} demand`}
			>
				<div className="demand-center" />
				<div className="demand-fill" style={fillStyle} />
			</div>
		</div>
	);
}

/**
 * After a mouse/touch press on a toggle control, drop focus so the roving
 * arrow-key navigation of the toggle groups stops swallowing the arrow keys
 * used to pan the city. Keyboard/virtual presses keep focus so keyboard
 * navigation of the sidebar still works.
 */
function blurOnPointerPress(e: PressEvent): void {
	if (e.pointerType === "keyboard" || e.pointerType === "virtual") return;
	const el = document.activeElement;
	if (el instanceof HTMLElement) el.blur();
}

function fmtInt(n: number): string {
	return Math.floor(n).toLocaleString();
}

function fmtMoney(n: number): string {
	const v = Math.floor(n);
	return `${v < 0 ? "\u2212" : ""}$${Math.abs(v).toLocaleString()}`;
}
