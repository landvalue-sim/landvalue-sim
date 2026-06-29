/**
 * FinancesDialog — an accessible modal showing the city's per-tick budget
 * breakdown and exposing the three tax-rate dials (R/C/I), which are otherwise
 * unreachable from the UI. Tax changes are sent to the worker on release
 * (`onChangeEnd`) so dragging doesn't spam commands or step a paused sim.
 */

import { useState } from "react";
import {
	Button,
	Dialog,
	DialogTrigger,
	Heading,
	Label,
	Modal,
	ModalOverlay,
	Slider,
	SliderOutput,
	SliderThumb,
	SliderTrack,
} from "react-aria-components";
import type { SimClient } from "../app/sim-client.ts";
import {
	BOND_AMOUNT,
	BOND_MONTHLY_PAYMENT,
	MAX_BONDS,
	MAX_TAX_RATE,
} from "../sim/index.ts";
import { useLiveStats } from "./hooks.ts";

const TAX_MAX_PCT = Math.round(MAX_TAX_RATE * 100);
const NEUTRAL_PCT = 7; // TAX_NEUTRAL_RATE — above this, demand is penalized.

export function FinancesDialog({
	sim,
}: {
	sim: SimClient;
}): React.ReactElement {
	return (
		<DialogTrigger>
			<Button className="finances-btn">City Finances\u2026</Button>
			<ModalOverlay className="modal-overlay" isDismissable>
				<Modal className="modal">
					<Dialog className="dialog">
						{({ close }) => <FinancesPanel sim={sim} onClose={close} />}
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}

function FinancesPanel({
	sim,
	onClose,
}: {
	sim: SimClient;
	onClose: () => void;
}): React.ReactElement {
	const stats = useLiveStats(sim.city);
	const net =
		stats.revenue -
		stats.serviceCost -
		stats.roadCost -
		stats.civicCost -
		stats.railCost -
		stats.bondPayment;

	return (
		<>
			<Heading slot="title" className="dialog-title">
				City Finances
			</Heading>

			<div className="fin-treasury">
				<span>Treasury</span>
				<span className={stats.treasury < 0 ? "neg" : "pos"}>
					{fmtMoney(stats.treasury)}
				</span>
			</div>

			<div className="fin-section-title">Budget (per tick)</div>
			<div className="fin-table">
				<FinRow label="Property tax" value={stats.revenue} sign="+" />
				<FinRow
					label="Service cost"
					value={-stats.serviceCost}
					sign={"\u2212"}
				/>
				<FinRow label="Road upkeep" value={-stats.roadCost} sign={"\u2212"} />
				<FinRow label="Rail upkeep" value={-stats.railCost} sign={"\u2212"} />
				<FinRow label="Civic upkeep" value={-stats.civicCost} sign={"\u2212"} />
				<FinRow
					label="Bond payments"
					value={-stats.bondPayment}
					sign={"\u2212"}
				/>
				<div className="fin-row fin-net">
					<span>Net</span>
					<span className={net >= 0 ? "pos" : "neg"}>
						{net >= 0 ? "+" : "\u2212"}
						{Math.abs(net).toFixed(1)}/tick
					</span>
				</div>
			</div>

			<div className="fin-section-title">Power</div>
			<div className="fin-table">
				<FinSimpleRow
					label="Capacity"
					value={`${Math.floor(stats.powerCapacity)} MW`}
				/>
				<FinSimpleRow
					label="Demand"
					value={`${Math.floor(stats.powerDemand)} MW`}
				/>
			</div>

			<div className="fin-section-title">Tax Rates</div>
			<p className="fin-hint">
				Above {NEUTRAL_PCT}% (neutral), higher rates raise revenue but soften
				demand for that zone.
			</p>
			<TaxSlider
				label="Residential"
				rate={stats.taxR}
				onCommit={(rate) =>
					sim.sendCommands([{ kind: "set-tax-rate", sector: "r", rate }])
				}
			/>
			<TaxSlider
				label="Commercial"
				rate={stats.taxC}
				onCommit={(rate) =>
					sim.sendCommands([{ kind: "set-tax-rate", sector: "c", rate }])
				}
			/>
			<TaxSlider
				label="Industrial"
				rate={stats.taxI}
				onCommit={(rate) =>
					sim.sendCommands([{ kind: "set-tax-rate", sector: "i", rate }])
				}
			/>

			<div className="fin-section-title">Bonds</div>
			<p className="fin-hint">
				Issue a ${BOND_AMOUNT.toLocaleString()} bond (${BOND_MONTHLY_PAYMENT}/mo
				for {MAX_BONDS * 12} months max). Up to {MAX_BONDS} bonds.
			</p>
			<Button
				className="finances-btn"
				onPress={() => sim.sendCommands([{ kind: "issue-bond" }])}
			>
				Issue Bond (${BOND_AMOUNT.toLocaleString()})
			</Button>

			<div className="fin-section-title">City Stats</div>
			<div className="fin-table">
				<FinSimpleRow
					label="Crime"
					value={Math.floor(stats.totalCrime).toLocaleString()}
				/>
				<FinSimpleRow
					label="Fires"
					value={Math.floor(stats.fireCount).toLocaleString()}
				/>
				<FinSimpleRow
					label="Education"
					value={`${Math.floor(stats.educationLevel)}%`}
				/>
				<FinSimpleRow
					label="Health"
					value={`${Math.floor(stats.healthLevel)}%`}
				/>
				<FinSimpleRow
					label="Connections"
					value={Math.floor(stats.connectionCount).toLocaleString()}
				/>
			</div>

			<Button className="dialog-close" onPress={onClose}>
				Close
			</Button>
		</>
	);
}

function FinRow({
	label,
	value,
	sign,
}: {
	label: string;
	value: number;
	sign: string;
}): React.ReactElement {
	return (
		<div className="fin-row">
			<span>{label}</span>
			<span className={value >= 0 ? "pos" : "neg"}>
				{sign}
				{Math.abs(value).toFixed(1)}/tick
			</span>
		</div>
	);
}

function FinSimpleRow({
	label,
	value,
}: {
	label: string;
	value: string;
}): React.ReactElement {
	return (
		<div className="fin-row">
			<span>{label}</span>
			<span>{value}</span>
		</div>
	);
}

function TaxSlider({
	label,
	rate,
	onCommit,
}: {
	label: string;
	rate: number;
	onCommit: (rate: number) => void;
}): React.ReactElement {
	// Seed the slider once from the live rate; thereafter it's user-driven so the
	// background poll doesn't fight the drag.
	const [pct, setPct] = useState(() => Math.round(rate * 100));

	return (
		<Slider
			className="tax-slider"
			minValue={0}
			maxValue={TAX_MAX_PCT}
			step={1}
			value={pct}
			onChange={setPct}
			onChangeEnd={(v) => onCommit((Array.isArray(v) ? (v[0] ?? 0) : v) / 100)}
		>
			<div className="tax-slider-head">
				<Label>{label}</Label>
				<SliderOutput>{(s) => `${s.state.getThumbValue(0)}%`}</SliderOutput>
			</div>
			<SliderTrack className="tax-slider-track">
				<SliderThumb className="tax-slider-thumb" />
			</SliderTrack>
		</Slider>
	);
}

function fmtMoney(n: number): string {
	const v = Math.floor(n);
	return `${v < 0 ? "\u2212" : ""}$${Math.abs(v).toLocaleString()}`;
}
