/**
 * The runtime shape of a situation definition.
 *
 * This is what the sim reads. It is *not* what content authors write — that is
 * `situations.json`, which uses keys, percentages, and channel names, and is
 * compiled into these structures once at module load by `situation-loader.ts`.
 * The split is deliberate: the template optimises for being written and read by
 * a person, and this optimises for being consumed by a bounded loop.
 *
 * Everything here is frozen at load and only ever read; instances live in
 * `state.situations` (see SIT in constants.ts).
 */

import type { ModifierEffect } from "./modifier-effect.ts";

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Fires when the watched aggregate is at or above `value`. */
export const TRIGGER_ABOVE = 1;
/** Fires when the watched aggregate is at or below `value`. */
export const TRIGGER_BELOW = -1;

/**
 * A trigger is *data*, not a predicate function.
 *
 * A table of callbacks would make the call graph non-static, which the code
 * rules rule out, and it would put arbitrary logic on the monthly evaluation
 * path. A comparison against an aggregate covers what the roster needs; when a
 * trigger wants something that is not an aggregate, the answer is to publish
 * that number as an aggregate — which is where it belonged anyway.
 */
export interface SituationTrigger {
	/** An AGG.* index to watch. */
	readonly agg: number;
	readonly op: typeof TRIGGER_ABOVE | typeof TRIGGER_BELOW;
	readonly value: number;
	/** 0..1, rolled against the seeded PRNG once a month while the line is crossed. */
	readonly chancePerMonth: number;
}

// ---------------------------------------------------------------------------
// Boundaries — what happens when progress reaches an end of the bar
// ---------------------------------------------------------------------------

/** Progress clamps at this end and the situation stays open. */
export const BOUNDARY_PIN = 0;
/** The outcome fires once and the slot is freed. */
export const BOUNDARY_RESOLVE = 1;

/**
 * What a resolution does on its way out.
 *
 * Deliberately small: a one-off treasury and influence swing, plus the option
 * to open a follow-on situation. That last one is what carries lasting
 * consequence without needing a separate "permanent modifier" store — a
 * follow-on with no trigger, no drift, and one expensive approach *is* a
 * lasting consequence, expressed with machinery that already exists.
 */
export interface SituationOutcome {
	readonly name: string;
	/** Added to the influence stock, clamped to its range. May be negative. */
	readonly influence: number;
	/** Added to the treasury. May be negative. */
	readonly treasury: number;
	/** Situation id to open as this one closes, or 0 for none. */
	readonly opens: number;
}

export interface SituationBoundary {
	readonly kind: typeof BOUNDARY_PIN | typeof BOUNDARY_RESOLVE;
	/** Non-null exactly when `kind` is BOUNDARY_RESOLVE. */
	readonly outcome: SituationOutcome | null;
}

// ---------------------------------------------------------------------------
// Stages, approaches, definitions
// ---------------------------------------------------------------------------

export interface SituationStage {
	/** Lowest progress (milli-percent) at which this stage is the live one. */
	readonly threshold: number;
	readonly name: string;
	readonly effects: ReadonlyArray<ModifierEffect>;
}

export interface SituationApproach {
	readonly name: string;
	readonly description: string;
	readonly influenceCost: number;
	readonly influenceUpkeep: number;
	/**
	 * Added to the situation's base drift each month. Signed, and free to point
	 * either way: on a problem an approach pushes progress down, and on a good
	 * spell it can push back up to hold the spell open a little longer.
	 */
	readonly progressPerMonth: number;
	readonly effects: ReadonlyArray<ModifierEffect>;
}

export interface SituationDef {
	/** 1-based, assigned from the template's array order. 0 means "no situation". */
	readonly id: number;
	/** Stable authoring handle, used for cross-references and lookups. */
	readonly key: string;
	readonly name: string;
	readonly description: string;
	/** Null for situations that only ever open as another's outcome. */
	readonly trigger: SituationTrigger | null;
	/** Progress (milli-percent) the situation opens at. */
	readonly startProgress: number;
	/**
	 * Monthly drift with no approach chosen, in milli-percent. Signed: positive
	 * for a condition that worsens if ignored, negative for one that fades on
	 * its own, zero for one that stays exactly where it is until acted on.
	 */
	readonly baseProgressPerMonth: number;
	/** What happens when progress reaches 0. */
	readonly atZero: SituationBoundary;
	/** What happens when progress reaches SITUATION_PROGRESS_MAX. */
	readonly atMax: SituationBoundary;
	/** Ordered by threshold, ascending; the first is always 0. */
	readonly stages: ReadonlyArray<SituationStage>;
	readonly approaches: ReadonlyArray<SituationApproach>;
}

/** Marks an empty slot in the situation pool. */
export const SITUATION_NONE = 0;
