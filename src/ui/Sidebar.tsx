/**
 * Sidebar — accessible tool/overlay/speed controls plus live city stats and
 * RCI demand bars. Built on React Aria Components so keyboard navigation and
 * screen-reader semantics come for free (DESIGN.md accessibility goal).
 */

import {
	type Key,
	type PressEvent,
	ToggleButton,
	ToggleButtonGroup,
} from "react-aria-components";
import type { SimClient } from "../app/sim-client.ts";
import type { InteractionStore } from "../app/store.ts";
import type { OverlayMode, Speed, Tool } from "../app/types.ts";
import { MAX_DEMAND } from "../sim/index.ts";
import { DevPanel } from "./DevPanel.tsx";
import { FinancesDialog } from "./FinancesDialog.tsx";
import { useInteraction, useLiveStats } from "./hooks.ts";

const TOOLS: ReadonlyArray<{ id: Tool; label: string; accent: string }> = [
	{ id: "zone-r", label: "Residential (1)", accent: "#22c55e" },
	{ id: "zone-c", label: "Commercial (2)", accent: "#3b82f6" },
	{ id: "zone-i", label: "Industrial (3)", accent: "#eab308" },
	{ id: "road", label: "Road (R)", accent: "#6b7280" },
	{ id: "demolish", label: "Demolish (X)", accent: "#ef4444" },
];

const OVERLAYS: ReadonlyArray<{ id: OverlayMode; label: string }> = [
	{ id: "none", label: "None" },
	{ id: "land-value", label: "Land Value" },
	{ id: "pollution", label: "Pollution" },
];

const SPEEDS: ReadonlyArray<{ id: Speed; label: string; aria: string }> = [
	{ id: 0, label: "⏸", aria: "Pause" },
	{ id: 1, label: "▶", aria: "Normal speed" },
	{ id: 2, label: "▶▶", aria: "Fast" },
	{ id: 3, label: "▶▶▶", aria: "Fastest" },
];

interface SidebarProps {
	store: InteractionStore;
	sim: SimClient;
}

export function Sidebar({ store, sim }: SidebarProps): React.ReactElement {
	const { tool, overlay, speed } = useInteraction(store);
	const stats = useLiveStats(sim.city);

	function firstKey(keys: Set<Key>): string | null {
		for (const k of keys) return String(k);
		return null;
	}

	return (
		<aside id="sidebar">
			<section>
				<div className="section-title">Tools</div>
				<ToggleButtonGroup
					selectionMode="single"
					className="btn-stack"
					selectedKeys={tool === "none" ? [] : [tool]}
					onSelectionChange={(keys) => {
						const k = firstKey(keys);
						store.setTool((k as Tool | null) ?? "none");
					}}
				>
					{TOOLS.map((t) => (
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
				<StatRow label="Population" value={fmtInt(stats.pop)} />
				<StatRow label="Jobs" value={fmtInt(stats.jobs)} />
				<StatRow label="Treasury" value={fmtMoney(stats.treasury)} />
				<StatRow label="Tick" value={fmtInt(stats.tick)} />
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
	return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString()}`;
}
