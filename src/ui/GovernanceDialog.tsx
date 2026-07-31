/**
 * GovernanceDialog — the influence readout, the policy list, and whatever
 * situations the city is currently living through.
 *
 * Modelled on FinancesDialog rather than inventing a second visual language:
 * governance is another ledger, and it reads best as one. Everything here is a
 * view over the shared buffer; the only writes are commands posted to the
 * worker.
 */

import {
	Button,
	Dialog,
	DialogTrigger,
	Heading,
	Modal,
	ModalOverlay,
} from "react-aria-components";
import type { SimClient } from "../app/sim-client.ts";
import {
	MAX_INFLUENCE,
	POLICY_DEFS,
	SITUATION_PROGRESS_MAX,
	type SituationDef,
	situationDef,
} from "../sim/index.ts";
import { type LiveSituation, useLiveStats, useSituations } from "./hooks.ts";

export function GovernanceDialog({
	sim,
}: {
	sim: SimClient;
}): React.ReactElement {
	return (
		<DialogTrigger>
			<Button className="finances-btn">Governance…</Button>
			<ModalOverlay className="modal-overlay" isDismissable>
				<Modal className="modal">
					<Dialog className="dialog">
						{({ close }) => <GovernancePanel sim={sim} onClose={close} />}
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}

function GovernancePanel({
	sim,
	onClose,
}: {
	sim: SimClient;
	onClose: () => void;
}): React.ReactElement {
	const stats = useLiveStats(sim.city);
	const situations = useSituations(sim.city);
	const net = stats.influenceIncome - stats.influenceUpkeep;

	return (
		<>
			<Heading slot="title" className="dialog-title">
				Governance
			</Heading>

			<div className="fin-treasury">
				<span>Influence</span>
				<span className={stats.influence > 0 ? "pos" : "neg"}>
					{Math.floor(stats.influence)}
					<span className="gov-cap">/{MAX_INFLUENCE}</span>
				</span>
			</div>

			<div className="fin-section-title">Political capital (per week)</div>
			<div className="fin-table">
				<div className="fin-row">
					<span>Accrual</span>
					<span className="pos">+{stats.influenceIncome.toFixed(1)}/wk</span>
				</div>
				<div className="fin-row">
					<span>Commitments</span>
					<span className={stats.influenceUpkeep > 0 ? "neg" : ""}>
						{"−"}
						{stats.influenceUpkeep.toFixed(1)}/wk
					</span>
				</div>
				<div className="fin-row fin-net">
					<span>Net</span>
					<span className={net >= 0 ? "pos" : "neg"}>
						{net >= 0 ? "+" : "−"}
						{Math.abs(net).toFixed(1)}/wk
					</span>
				</div>
			</div>
			<p className="fin-hint">
				An educated, healthy, safe city grants its government room to act. Run
				out of influence and the newest standing commitment is dropped.
			</p>

			<div className="fin-section-title">Policies</div>
			{POLICY_DEFS.map((policy) => {
				// Read straight from the shared buffer. `useLiveStats` re-renders this
				// panel on its own poll, so the flags are never more than a poll stale
				// and there is nothing here worth a second subscription.
				const enacted = (sim.city.policies[policy.id] ?? 0) !== 0;
				return (
					<div className="gov-entry" key={policy.id}>
						<div className="gov-entry-head">
							<span className="gov-entry-name">{policy.name}</span>
							<span className="gov-cost">
								{enacted
									? `${policy.influenceUpkeep}/wk`
									: `${policy.influenceCost} + ${policy.influenceUpkeep}/wk`}
							</span>
						</div>
						<p className="fin-hint">{policy.description}</p>
						<Button
							className={`gov-btn${enacted ? " is-active" : ""}`}
							isDisabled={!enacted && stats.influence < policy.influenceCost}
							onPress={() =>
								sim.sendCommands([
									enacted
										? { kind: "repeal-policy", policyId: policy.id }
										: { kind: "enact-policy", policyId: policy.id },
								])
							}
						>
							{enacted ? "Repeal" : "Enact"}
						</Button>
					</div>
				);
			})}

			<div className="fin-section-title">
				Situations{situations.length > 0 ? ` (${situations.length})` : ""}
			</div>
			{situations.length === 0 ? (
				<p className="fin-hint">Nothing is going wrong. Enjoy it.</p>
			) : (
				situations.map((situation) => (
					<SituationCard
						key={situation.slot}
						situation={situation}
						influence={stats.influence}
						sim={sim}
					/>
				))
			)}

			<Button className="dialog-close" onPress={onClose}>
				Close
			</Button>
		</>
	);
}

function SituationCard({
	situation,
	influence,
	sim,
}: {
	situation: LiveSituation;
	influence: number;
	sim: SimClient;
}): React.ReactElement | null {
	const def: SituationDef | undefined = situationDef(situation.defId);
	if (def === undefined) return null;

	const stage = def.stages[situation.stage];
	const pct = (situation.progress / SITUATION_PROGRESS_MAX) * 100;
	// A rising bar is the city getting worse, so the trend arrow reads the sign
	// of last month's move rather than the bar's absolute height.
	const trend =
		situation.lastDelta > 0 ? "▲" : situation.lastDelta < 0 ? "▼" : "";

	return (
		<div className="gov-entry">
			<div className="gov-entry-head">
				<span className="gov-entry-name">{def.name}</span>
				<span className={situation.lastDelta > 0 ? "neg" : "pos"}>
					{trend} {pct.toFixed(0)}%
				</span>
			</div>
			<div className="gov-bar">
				<div
					className="gov-bar-fill"
					style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
				/>
			</div>
			<div className="gov-stage">{stage?.name ?? "—"}</div>
			<p className="fin-hint">{def.description}</p>

			{def.approaches.map((approach, i) => {
				const index = i + 1;
				const active = situation.approach === index;
				return (
					<Button
						key={approach.name}
						className={`gov-btn${active ? " is-active" : ""}`}
						isDisabled={!active && influence < approach.influenceCost}
						onPress={() =>
							sim.sendCommands([
								{
									kind: "set-situation-approach",
									slot: situation.slot,
									// Pressing the active approach abandons it.
									approach: active ? 0 : index,
								},
							])
						}
					>
						<span>{active ? `✓ ${approach.name}` : approach.name}</span>
						<span className="gov-cost">
							{active
								? `${approach.influenceUpkeep}/wk`
								: `${approach.influenceCost} + ${approach.influenceUpkeep}/wk`}
						</span>
					</Button>
				);
			})}
		</div>
	);
}
