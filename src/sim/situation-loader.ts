/**
 * Compile `situations.json` into the runtime definitions the sim reads.
 *
 * Runs once, at module load, on a template that is bundled at build time (a
 * plain `import`, not a fetch). Nothing here is on the tick path.
 *
 * The validation is hand-rolled rather than zod, because the sim core takes no
 * runtime dependencies — that is what makes it portable and headless-testable.
 * The trade is that every field has to be checked by hand, so the rule is: no
 * field is read without being validated, and every failure throws with the path
 * that caused it. A content error is a build error, not a default to fall back
 * on (rule 5 — never silently swallow).
 *
 * The template speaks in keys, percentages, and channel names; the runtime
 * speaks in dense ids, milli-percent, and array indices. Translating between
 * the two is this file's whole job.
 */

import {
	AGG,
	MAX_SITUATION_APPROACHES,
	MAX_SITUATION_DEFS,
	MAX_SITUATION_STAGES,
	MOD,
	SITUATION_PROGRESS_MAX,
	SITUATION_START_PROGRESS,
} from "./constants.ts";
import {
	EFFECT_ADD,
	EFFECT_MULT,
	MAX_EFFECTS_PER_ENTRY,
	type ModifierEffect,
} from "./modifier-effect.ts";
import {
	BOUNDARY_PIN,
	BOUNDARY_RESOLVE,
	type SituationApproach,
	type SituationBoundary,
	type SituationDef,
	type SituationOutcome,
	type SituationStage,
	type SituationTrigger,
	TRIGGER_ABOVE,
	TRIGGER_BELOW,
} from "./situation-types.ts";

/** Template format this loader understands. Bumped when the shape changes. */
export const SITUATION_TEMPLATE_VERSION = 1;

/**
 * Name → index lookups for the two enum-ish tables a template refers to by
 * name. Both are objects whose values are all numbers, so widening them to a
 * record is an assignment rather than an assertion.
 */
const AGG_BY_NAME: Readonly<Record<string, number>> = AGG;
const MOD_BY_NAME: Readonly<Record<string, number>> = MOD;

/** Template percentages become milli-percent, the unit progress is stored in. */
const PER_PERCENT = SITUATION_PROGRESS_MAX / 100;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function loadSituations(raw: unknown): ReadonlyArray<SituationDef> {
	const root = requireRecord(raw, "situations");
	const version = requireNumber(root["version"], "situations.version");
	if (version !== SITUATION_TEMPLATE_VERSION) {
		throw new Error(
			`situations.version: expected ${SITUATION_TEMPLATE_VERSION}, got ${version}`,
		);
	}

	const entries = requireArray(root["situations"], "situations.situations");
	if (entries.length === 0) {
		throw new Error("situations.situations: template defines no situations");
	}
	if (entries.length > MAX_SITUATION_DEFS) {
		throw new Error(
			`situations.situations: ${entries.length} entries exceeds MAX_SITUATION_DEFS (${MAX_SITUATION_DEFS})`,
		);
	}

	// Ids come from array order, so keys have to be collected before any entry
	// is compiled — a situation may name one that appears after it.
	const idsByKey = collectKeys(entries);

	const defs: SituationDef[] = [];
	for (let i = 0; i < entries.length; i++) {
		defs.push(compileSituation(entries[i], i + 1, idsByKey));
	}
	return defs;
}

function collectKeys(
	entries: ReadonlyArray<unknown>,
): ReadonlyMap<string, number> {
	const idsByKey = new Map<string, number>();
	for (let i = 0; i < entries.length; i++) {
		const path = `situations[${i}]`;
		const key = requireString(
			requireRecord(entries[i], path)["key"],
			`${path}.key`,
		);
		if (idsByKey.has(key)) {
			throw new Error(`${path}.key: duplicate key "${key}"`);
		}
		idsByKey.set(key, i + 1);
	}
	return idsByKey;
}

// ---------------------------------------------------------------------------
// Situations
// ---------------------------------------------------------------------------

function compileSituation(
	raw: unknown,
	id: number,
	idsByKey: ReadonlyMap<string, number>,
): SituationDef {
	const path = `situations[${id - 1}]`;
	const entry = requireRecord(raw, path);
	const key = requireString(entry["key"], `${path}.key`);

	const startPercent = optionalNumber(
		entry["startProgress"],
		`${path}.startProgress`,
		SITUATION_START_PROGRESS / PER_PERCENT,
	);
	requireRange(startPercent, 0, 100, `${path}.startProgress`);

	const basePercent = requireNumber(
		entry["baseProgressPerMonth"],
		`${path}.baseProgressPerMonth`,
	);
	requireRange(basePercent, -100, 100, `${path}.baseProgressPerMonth`);

	const approaches = compileApproaches(entry["approaches"], path);

	// A situation that cannot move is an eternal modifier the player has no
	// handle on. That is never what an author meant, so it is an error rather
	// than a quirk to discover in play.
	const canMove =
		basePercent !== 0 || approaches.some((a) => a.progressPerMonth !== 0);
	if (!canMove) {
		throw new Error(
			`${path}: neither its drift nor any approach can move progress, so it could never end`,
		);
	}

	return {
		id,
		key,
		name: requireString(entry["name"], `${path}.name`),
		description: requireString(entry["description"], `${path}.description`),
		trigger: compileTrigger(entry["trigger"], path),
		startProgress: Math.round(startPercent * PER_PERCENT),
		baseProgressPerMonth: Math.round(basePercent * PER_PERCENT),
		atZero: compileBoundary(entry["atZero"], `${path}.atZero`, idsByKey),
		atMax: compileBoundary(entry["atMax"], `${path}.atMax`, idsByKey),
		stages: compileStages(entry["stages"], path),
		approaches,
	};
}

function compileTrigger(raw: unknown, path: string): SituationTrigger | null {
	// Null is meaningful, not missing: it marks a situation that only ever opens
	// as another's outcome.
	if (raw === null || raw === undefined) return null;

	const entry = requireRecord(raw, `${path}.trigger`);
	const aggName = requireString(
		entry["aggregate"],
		`${path}.trigger.aggregate`,
	);
	const agg = AGG_BY_NAME[aggName];
	if (agg === undefined || aggName === "COUNT") {
		throw new Error(
			`${path}.trigger.aggregate: "${aggName}" is not an aggregate`,
		);
	}

	const op = requireString(entry["op"], `${path}.trigger.op`);
	if (op !== "above" && op !== "below") {
		throw new Error(
			`${path}.trigger.op: expected "above" or "below", got "${op}"`,
		);
	}

	const chance = requireNumber(
		entry["chancePerMonth"],
		`${path}.trigger.chancePerMonth`,
	);
	// A zero chance is a trigger that can never fire, which is what `null` is
	// for — saying it two ways invites one of them to be wrong.
	if (chance <= 0 || chance > 1) {
		throw new Error(
			`${path}.trigger.chancePerMonth: expected 0 < chance <= 1, got ${chance}`,
		);
	}

	return {
		agg,
		op: op === "above" ? TRIGGER_ABOVE : TRIGGER_BELOW,
		value: requireNumber(entry["value"], `${path}.trigger.value`),
		chancePerMonth: chance,
	};
}

function compileBoundary(
	raw: unknown,
	path: string,
	idsByKey: ReadonlyMap<string, number>,
): SituationBoundary {
	const entry = requireRecord(raw, path);
	const kind = requireString(entry["kind"], `${path}.kind`);

	if (kind === "pin") {
		return { kind: BOUNDARY_PIN, outcome: null };
	}
	if (kind !== "resolve") {
		throw new Error(`${path}.kind: expected "pin" or "resolve", got "${kind}"`);
	}
	return {
		kind: BOUNDARY_RESOLVE,
		outcome: compileOutcome(entry, path, idsByKey),
	};
}

function compileOutcome(
	entry: Readonly<Record<string, unknown>>,
	path: string,
	idsByKey: ReadonlyMap<string, number>,
): SituationOutcome {
	const opensKey = entry["opens"];
	let opens = 0;
	if (opensKey !== null && opensKey !== undefined) {
		const name = requireString(opensKey, `${path}.opens`);
		const id = idsByKey.get(name);
		if (id === undefined) {
			throw new Error(`${path}.opens: no situation with key "${name}"`);
		}
		opens = id;
	}

	return {
		name: requireString(entry["name"], `${path}.name`),
		influence: optionalNumber(entry["influence"], `${path}.influence`, 0),
		treasury: optionalNumber(entry["treasury"], `${path}.treasury`, 0),
		opens,
	};
}

function compileStages(
	raw: unknown,
	path: string,
): ReadonlyArray<SituationStage> {
	const entries = requireArray(raw, `${path}.stages`);
	if (entries.length === 0) {
		throw new Error(`${path}.stages: a situation needs at least one stage`);
	}
	if (entries.length > MAX_SITUATION_STAGES) {
		throw new Error(
			`${path}.stages: ${entries.length} exceeds MAX_SITUATION_STAGES (${MAX_SITUATION_STAGES})`,
		);
	}

	const stages: SituationStage[] = [];
	let previous = -1;
	for (let i = 0; i < entries.length; i++) {
		const stagePath = `${path}.stages[${i}]`;
		const entry = requireRecord(entries[i], stagePath);
		const at = requireNumber(entry["at"], `${stagePath}.at`);
		requireRange(at, 0, 100, `${stagePath}.at`);
		// The first stage has to cover progress 0 or a situation could sit below
		// every threshold with no stage live at all.
		if (i === 0 && at !== 0) {
			throw new Error(`${stagePath}.at: the first stage must start at 0`);
		}
		if (at <= previous) {
			throw new Error(
				`${stagePath}.at: thresholds must ascend, ${at} follows ${previous}`,
			);
		}
		previous = at;

		stages.push({
			threshold: Math.round(at * PER_PERCENT),
			name: requireString(entry["name"], `${stagePath}.name`),
			effects: compileEffects(entry["effects"], stagePath),
		});
	}
	return stages;
}

function compileApproaches(
	raw: unknown,
	path: string,
): ReadonlyArray<SituationApproach> {
	const entries = requireArray(raw, `${path}.approaches`);
	if (entries.length > MAX_SITUATION_APPROACHES) {
		throw new Error(
			`${path}.approaches: ${entries.length} exceeds MAX_SITUATION_APPROACHES (${MAX_SITUATION_APPROACHES})`,
		);
	}

	const approaches: SituationApproach[] = [];
	for (let i = 0; i < entries.length; i++) {
		const approachPath = `${path}.approaches[${i}]`;
		const entry = requireRecord(entries[i], approachPath);

		const perMonth = requireNumber(
			entry["progressPerMonth"],
			`${approachPath}.progressPerMonth`,
		);
		requireRange(perMonth, -100, 100, `${approachPath}.progressPerMonth`);

		approaches.push({
			name: requireString(entry["name"], `${approachPath}.name`),
			description: requireString(
				entry["description"],
				`${approachPath}.description`,
			),
			influenceCost: requireNonNegative(
				entry["influenceCost"],
				`${approachPath}.influenceCost`,
			),
			influenceUpkeep: requireNonNegative(
				entry["influenceUpkeep"],
				`${approachPath}.influenceUpkeep`,
			),
			progressPerMonth: Math.round(perMonth * PER_PERCENT),
			effects: compileEffects(entry["effects"], approachPath),
		});
	}
	return approaches;
}

function compileEffects(
	raw: unknown,
	path: string,
): ReadonlyArray<ModifierEffect> {
	const entries = requireArray(raw, `${path}.effects`);
	if (entries.length > MAX_EFFECTS_PER_ENTRY) {
		throw new Error(
			`${path}.effects: ${entries.length} exceeds MAX_EFFECTS_PER_ENTRY (${MAX_EFFECTS_PER_ENTRY})`,
		);
	}

	const effects: ModifierEffect[] = [];
	for (let i = 0; i < entries.length; i++) {
		const effectPath = `${path}.effects[${i}]`;
		const entry = requireRecord(entries[i], effectPath);

		const channelName = requireString(
			entry["channel"],
			`${effectPath}.channel`,
		);
		const channel = MOD_BY_NAME[channelName];
		if (channel === undefined || channelName === "COUNT") {
			throw new Error(
				`${effectPath}.channel: "${channelName}" is not a modifier channel`,
			);
		}

		const op = requireString(entry["op"], `${effectPath}.op`);
		if (op !== "add" && op !== "multiply") {
			throw new Error(
				`${effectPath}.op: expected "add" or "multiply", got "${op}"`,
			);
		}

		effects.push({
			channel,
			kind: op === "add" ? EFFECT_ADD : EFFECT_MULT,
			value: requireNumber(entry["value"], `${effectPath}.value`),
		});
	}
	return effects;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
	value: unknown,
	path: string,
): Readonly<Record<string, unknown>> {
	if (!isRecord(value)) throw new Error(`${path}: expected an object`);
	return value;
}

function requireArray(value: unknown, path: string): ReadonlyArray<unknown> {
	if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
	return value;
}

function requireString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${path}: expected a non-empty string`);
	}
	return value;
}

function requireNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${path}: expected a finite number`);
	}
	return value;
}

function optionalNumber(
	value: unknown,
	path: string,
	fallback: number,
): number {
	if (value === undefined || value === null) return fallback;
	return requireNumber(value, path);
}

function requireNonNegative(value: unknown, path: string): number {
	const n = requireNumber(value, path);
	if (n < 0)
		throw new Error(`${path}: expected a non-negative number, got ${n}`);
	return n;
}

function requireRange(
	value: number,
	min: number,
	max: number,
	path: string,
): void {
	if (value < min || value > max) {
		throw new Error(`${path}: expected ${min}..${max}, got ${value}`);
	}
}
