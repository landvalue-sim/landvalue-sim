/**
 * DevPanel — collapsible tick profiler + invariant-violation log. Data is
 * pushed from the worker (where the sim actually runs) as periodic snapshots;
 * this only renders in dev builds. Uses React Aria's Disclosure for an
 * accessible collapse/expand.
 */

import { useState } from "react";
import { Button, Disclosure, DisclosurePanel } from "react-aria-components";
import type { SimClient } from "../app/sim-client.ts";
import { SYSTEM_NAMES } from "../sim/index.ts";
import { useRenderStats, useSimStats } from "./hooks.ts";

const MAX_SHOWN_VIOLATIONS = 20;

export function DevPanel({
	sim,
}: {
	sim: SimClient;
}): React.ReactElement | null {
	const stats = useSimStats(sim);
	const [infiniteMoney, setInfiniteMoney] = useState(false);
	const [showFps, setShowFps] = useState(true);
	const frame = useRenderStats(showFps);
	if (!import.meta.env.DEV) return null;

	const profile = stats?.profile ?? null;
	const violations = stats?.violations ?? [];
	const shown = violations.slice(0, MAX_SHOWN_VIOLATIONS);

	return (
		<Disclosure id="dev-panel" defaultExpanded>
			<h3 className="dev-panel-title">
				<Button slot="trigger" className="dev-panel-trigger">
					Dev Stats
				</Button>
			</h3>
			<DisclosurePanel>
				<div className="dev-section-title">Debug</div>
				<Button className="dev-action-btn" onPress={() => sim.loadTestCity()}>
					Load Test City
				</Button>
				<Button
					className={`dev-action-btn${infiniteMoney ? " is-active" : ""}`}
					onPress={() => {
						const next = !infiniteMoney;
						setInfiniteMoney(next);
						sim.setInfiniteMoney(next);
					}}
				>
					Infinite Money: {infiniteMoney ? "ON" : "OFF"}
				</Button>
				<Button
					className={`dev-action-btn${showFps ? " is-active" : ""}`}
					onPress={() => setShowFps(!showFps)}
				>
					Renderer FPS: {showFps ? "ON" : "OFF"}
				</Button>

				{showFps && (
					<>
						<div className="dev-section-title">Renderer</div>
						<div className="dev-fps">
							<span className="dev-fps-value">{Math.round(frame.fps)} fps</span>
							<span className="dev-fps-min">
								min {Math.round(frame.minFps)}
							</span>
						</div>
						<div className="dev-table">
							<div className="dev-row dev-header">
								<span>Frame (ms)</span>
								<span>Last</span>
								<span>Avg</span>
								<span>Max</span>
							</div>
							<div className="dev-row">
								<span className="dev-name">period</span>
								<span>{fmt(frame.lastPeriod)}</span>
								<span>{fmt(frame.avgPeriod)}</span>
								<span>{fmt(frame.maxPeriod)}</span>
							</div>
							<div className="dev-row">
								<span className="dev-name">update</span>
								<span>{fmt(frame.lastWork)}</span>
								<span>{fmt(frame.avgWork)}</span>
								<span>{fmt(frame.maxWork)}</span>
							</div>
						</div>
					</>
				)}

				<div className="dev-section-title">Tick Profiler (ms)</div>
				<div className="dev-table">
					<div className="dev-row dev-header">
						<span>System</span>
						<span>Last</span>
						<span>Avg</span>
						<span>Max</span>
					</div>
					{SYSTEM_NAMES.map((name) => {
						const s = profile?.systems.get(name);
						return (
							<div className="dev-row" key={name}>
								<span className="dev-name">{name}</span>
								<span>{s ? fmt(s.last) : "—"}</span>
								<span>{s ? fmt(s.avg) : "—"}</span>
								<span>{s ? fmt(s.max) : "—"}</span>
							</div>
						);
					})}
					<div className="dev-row dev-total">
						<span className="dev-name">total</span>
						<span>{profile ? fmt(profile.totalTick.last) : "—"}</span>
						<span>{profile ? fmt(profile.totalTick.avg) : "—"}</span>
						<span>{profile ? fmt(profile.totalTick.max) : "—"}</span>
					</div>
				</div>

				<div className="dev-section-title">
					Violations{" "}
					<span
						className={`dev-violation-count${
							violations.length > 0 ? " has-violations" : ""
						}`}
					>
						{violations.length}
					</span>
					<Button
						className="dev-clear-btn"
						onPress={() => sim.clearViolations()}
					>
						Clear
					</Button>
				</div>
				<div className="dev-violations">
					{shown.map((v) => (
						<div
							className="dev-violation"
							key={`${v.tick}-${v.system}-${v.message}`}
						>
							[t{v.tick}] {v.system}: {v.message}
						</div>
					))}
					{violations.length > MAX_SHOWN_VIOLATIONS && (
						<div className="dev-violation dev-more">
							… and {violations.length - MAX_SHOWN_VIOLATIONS} more
						</div>
					)}
				</div>
			</DisclosurePanel>
		</Disclosure>
	);
}

function fmt(ms: number): string {
	if (ms < 0.01) return "0.00";
	if (ms < 1) return ms.toFixed(2);
	return ms.toFixed(1);
}
