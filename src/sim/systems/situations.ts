/**
 * Situations — the pool of ongoing conditions and the monthly pass that moves
 * them.
 *
 * Runs at the *bottom* of the tick, after every other system has published its
 * aggregates, so a trigger reads this tick's numbers rather than last tick's. A
 * stage change therefore reaches the modifier bus on the following tick, since
 * the bus is rebuilt at the top. That one-tick lag is harmless at a one-day
 * tick and much safer than making the two systems mutually reentrant.
 *
 * Only fires on month boundaries. Situations are slow by nature and a monthly
 * cadence keeps the per-tick cost at a single modulo on 29 days out of 30.
 *
 * Progress runs 0..SITUATION_PROGRESS_MAX and drifts in whichever direction its
 * definition says: up for a condition that worsens when ignored, down for a
 * good spell that fades, nowhere at all for an aftermath that sits until it is
 * dealt with. Each end of the bar is independently either a wall the progress
 * pins against or a resolution with its own outcome, so one piece of machinery
 * covers "fix it or it gets worse", "enjoy it while it lasts", and "this ends
 * one of two ways and they are not the same ending".
 *
 * See design_docs/INFLUENCE-AND-SITUATIONS.md.
 */

import type { CityState } from "../city-state.ts";
import {
	AGG,
	DAYS_PER_MONTH,
	MAX_INFLUENCE,
	MAX_SITUATIONS,
	SIT,
	SITUATION_PROGRESS_MAX,
} from "../constants.ts";
import { nextFloat } from "../prng.ts";
import {
	SITUATION_DEF_COUNT,
	SITUATION_DEFS,
	situationDef,
} from "../situation-defs.ts";
import {
	BOUNDARY_RESOLVE,
	SITUATION_NONE,
	type SituationBoundary,
	type SituationDef,
	type SituationOutcome,
	TRIGGER_ABOVE,
} from "../situation-types.ts";
import { totalInfluenceUpkeep } from "./influence.ts";

/**
 * Situations that an outcome asked to open, held until the advance pass is
 * over.
 *
 * Opening one inline would drop it into a slot the pass has not reached yet,
 * handing it a free month of drift on the very tick it was created.
 * Pre-allocated at module load and refilled in place, never grown (rule 3).
 */
const pendingOpens = new Int32Array(MAX_SITUATIONS);
let pendingCount = 0;

export function updateSituations(state: CityState): void {
	const agg = state.aggregates;
	if ((agg[AGG.TICK] ?? 0) % DAYS_PER_MONTH !== 0) return;

	pendingCount = 0;
	advanceSituations(state);
	flushPendingOpens(state);
	evaluateTriggers(state);

	agg[AGG.SITUATION_COUNT] = countOpenSituations(state);
	// A resolved situation takes its approach's commitment with it, and a
	// follow-on arrives with none. Either way the standing bill has moved.
	agg[AGG.INFLUENCE_UPKEEP] = totalInfluenceUpkeep(state);
}

/** Drift every open situation one month and settle whatever reaches an end. */
function advanceSituations(state: CityState): void {
	const { situations } = state;

	for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
		const base = slot * SIT.STRIDE;
		const def = situationDef(situations[base + SIT.DEF] ?? SITUATION_NONE);
		if (def === undefined) continue;

		let delta = def.baseProgressPerMonth;
		const approachIdx = situations[base + SIT.APPROACH] ?? 0;
		if (approachIdx > 0) {
			delta += def.approaches[approachIdx - 1]?.progressPerMonth ?? 0;
		}

		const before = situations[base + SIT.PROGRESS] ?? 0;
		const after = clampInt(
			before + Math.round(delta),
			0,
			SITUATION_PROGRESS_MAX,
		);
		situations[base + SIT.PROGRESS] = after;
		situations[base + SIT.LAST_DELTA] = after - before;

		const boundary = after === 0 ? def.atZero : def.atMax;
		if (settleBoundary(state, slot, boundary, after)) continue;
		situations[base + SIT.STAGE] = stageForProgress(def, after);
	}
}

/**
 * Close the situation in `slot` if `progress` has reached an end that resolves.
 * Returns whether the slot was freed; a pinned end, or progress that is not at
 * an end at all, leaves it open.
 */
function settleBoundary(
	state: CityState,
	slot: number,
	boundary: SituationBoundary,
	progress: number,
): boolean {
	if (progress !== 0 && progress !== SITUATION_PROGRESS_MAX) return false;
	if (boundary.kind !== BOUNDARY_RESOLVE) return false;

	if (boundary.outcome !== null) applyOutcome(state, boundary.outcome);
	clearSlot(state, slot);
	return true;
}

/**
 * Pay out a resolution. Any follow-on is queued rather than opened, so it
 * cannot land in a slot this month's pass has yet to visit.
 */
function applyOutcome(state: CityState, outcome: SituationOutcome): void {
	const agg = state.aggregates;

	if (outcome.treasury !== 0) {
		agg[AGG.TREASURY] = (agg[AGG.TREASURY] ?? 0) + outcome.treasury;
	}
	if (outcome.influence !== 0) {
		agg[AGG.INFLUENCE] = clampInt(
			(agg[AGG.INFLUENCE] ?? 0) + outcome.influence,
			0,
			MAX_INFLUENCE,
		);
	}
	if (outcome.opens !== SITUATION_NONE && pendingCount < MAX_SITUATIONS) {
		pendingOpens[pendingCount] = outcome.opens;
		pendingCount++;
	}
}

function flushPendingOpens(state: CityState): void {
	for (let i = 0; i < pendingCount; i++) {
		void openSituation(state, pendingOpens[i] ?? SITUATION_NONE);
	}
	pendingCount = 0;
}

/**
 * Open any situation whose watched aggregate has crossed its line and whose
 * monthly roll comes up. Definitions with no trigger are skipped entirely —
 * they exist only to be opened as another situation's outcome.
 *
 * The roll is taken only when the line is crossed, so an uneventful month
 * consumes no randomness. That makes the PRNG stream state-dependent, which is
 * fine — it is still a pure function of (seed, commands), which is what
 * determinism requires.
 */
function evaluateTriggers(state: CityState): void {
	for (let i = 0; i < SITUATION_DEF_COUNT; i++) {
		const def = SITUATION_DEFS[i];
		if (def === undefined || def.trigger === null) continue;
		if (isSituationOpen(state, def.id)) continue;

		const value = state.aggregates[def.trigger.agg] ?? 0;
		const crossed =
			def.trigger.op === TRIGGER_ABOVE
				? value >= def.trigger.value
				: value <= def.trigger.value;
		if (!crossed) continue;

		if (nextFloat(state.rng) >= def.trigger.chancePerMonth) continue;
		void openSituation(state, def.id);
	}
}

/**
 * Put `defId` into the first free slot. Returns the slot, or -1 when the pool
 * is full — a full pool silently drops the new situation rather than evicting
 * one the player is already dealing with.
 */
export function openSituation(state: CityState, defId: number): number {
	const def = situationDef(defId);
	if (def === undefined) return -1;
	const { situations } = state;

	for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
		const base = slot * SIT.STRIDE;
		if ((situations[base + SIT.DEF] ?? SITUATION_NONE) !== SITUATION_NONE) {
			continue;
		}
		situations[base + SIT.DEF] = defId;
		situations[base + SIT.PROGRESS] = def.startProgress;
		situations[base + SIT.STAGE] = stageForProgress(def, def.startProgress);
		situations[base + SIT.APPROACH] = 0;
		situations[base + SIT.START_TICK] = Math.floor(
			state.aggregates[AGG.TICK] ?? 0,
		);
		situations[base + SIT.LAST_DELTA] = 0;
		return slot;
	}
	return -1;
}

/** Whether a situation with this definition is already occupying a slot. */
export function isSituationOpen(state: CityState, defId: number): boolean {
	for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
		if (state.situations[slot * SIT.STRIDE + SIT.DEF] === defId) return true;
	}
	return false;
}

export function countOpenSituations(state: CityState): number {
	let count = 0;
	for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
		const defId =
			state.situations[slot * SIT.STRIDE + SIT.DEF] ?? SITUATION_NONE;
		if (defId !== SITUATION_NONE) count++;
	}
	return count;
}

function clearSlot(state: CityState, slot: number): void {
	const base = slot * SIT.STRIDE;
	for (let field = 0; field < SIT.STRIDE; field++) {
		state.situations[base + field] = 0;
	}
}

/**
 * The highest stage whose threshold `progress` has reached. The loader
 * guarantees the list is non-empty, ascending, and starts at 0, so this always
 * lands on a real stage.
 */
function stageForProgress(def: SituationDef, progress: number): number {
	let stage = 0;
	for (let i = 0; i < def.stages.length; i++) {
		const threshold = def.stages[i]?.threshold ?? 0;
		if (progress >= threshold) stage = i;
	}
	return stage;
}

function clampInt(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * One slot's contents, for readers outside the sim.
 *
 * An out-param rather than a return value so a UI polling every frame allocates
 * nothing per read. `defId` of 0 means the slot is free and the rest is stale.
 */
export interface SituationSlotView {
	defId: number;
	progress: number;
	stage: number;
	approach: number;
	startTick: number;
	lastDelta: number;
}

/** Allocate a view struct. Cold path — call once, keep it. */
export function createSituationSlotView(): SituationSlotView {
	return {
		defId: 0,
		progress: 0,
		stage: 0,
		approach: 0,
		startTick: 0,
		lastDelta: 0,
	};
}

export function readSituationSlot(
	state: CityState,
	slot: number,
	out: SituationSlotView,
): void {
	if (slot < 0 || slot >= MAX_SITUATIONS) {
		out.defId = SITUATION_NONE;
		return;
	}
	const base = slot * SIT.STRIDE;
	out.defId = state.situations[base + SIT.DEF] ?? SITUATION_NONE;
	out.progress = state.situations[base + SIT.PROGRESS] ?? 0;
	out.stage = state.situations[base + SIT.STAGE] ?? 0;
	out.approach = state.situations[base + SIT.APPROACH] ?? 0;
	out.startTick = state.situations[base + SIT.START_TICK] ?? 0;
	out.lastDelta = state.situations[base + SIT.LAST_DELTA] ?? 0;
}

/**
 * Choose (or, with `approach` 0, abandon) the standing response to an open
 * situation, charging the approach's up-front influence cost.
 *
 * Switching approaches charges the new one in full; the old one's cost is not
 * refunded. Returns false and changes nothing when the slot is empty, the
 * approach does not exist, or the city cannot afford it.
 */
export function setSituationApproach(
	state: CityState,
	slot: number,
	approach: number,
): boolean {
	if (slot < 0 || slot >= MAX_SITUATIONS) return false;
	const base = slot * SIT.STRIDE;
	const def = situationDef(state.situations[base + SIT.DEF] ?? SITUATION_NONE);
	if (def === undefined) return false;
	if ((state.situations[base + SIT.APPROACH] ?? 0) === approach) return false;

	if (approach === 0) {
		state.situations[base + SIT.APPROACH] = 0;
		state.aggregates[AGG.INFLUENCE_UPKEEP] = totalInfluenceUpkeep(state);
		return true;
	}

	const chosen = def.approaches[approach - 1];
	if (chosen === undefined) return false;

	const agg = state.aggregates;
	const influence = agg[AGG.INFLUENCE] ?? 0;
	if (influence < chosen.influenceCost) return false;

	agg[AGG.INFLUENCE] = influence - chosen.influenceCost;
	state.situations[base + SIT.APPROACH] = approach;
	agg[AGG.INFLUENCE_UPKEEP] = totalInfluenceUpkeep(state);
	return true;
}
