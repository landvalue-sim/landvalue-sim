/**
 * The compiled situation roster.
 *
 * Content lives in `situations.json` and is validated into runtime definitions
 * by `situation-loader.ts` at module load. This file is only the seam: import
 * the template, compile it, expose lookups. Adding or retuning a situation
 * means editing the JSON and nothing else.
 *
 * A bad template throws here, at import time, which fails every test and the
 * dev server on the first load rather than at the moment a situation happens to
 * trigger an hour into a game.
 *
 * Ids are assigned from the template's array order and are what the situation
 * pool stores. Code that needs a specific situation looks it up by key —
 * `requireSituationId("housing-crunch")` — so a renamed key fails loudly at
 * startup instead of silently matching nothing.
 */

import { loadSituations } from "./situation-loader.ts";
import type { SituationDef } from "./situation-types.ts";
import template from "./situations.json";

export const SITUATION_DEFS: ReadonlyArray<SituationDef> =
	loadSituations(template);

export const SITUATION_DEF_COUNT = SITUATION_DEFS.length;

/**
 * The definition for `id`, or undefined for SITUATION_NONE and unknown ids.
 * Ids are 1-based and dense, so this is an index rather than a search.
 */
export function situationDef(id: number): SituationDef | undefined {
	if (id < 1 || id > SITUATION_DEF_COUNT) return undefined;
	return SITUATION_DEFS[id - 1];
}

/** The id for an authoring key, or 0 if no situation uses it. */
export function situationIdByKey(key: string): number {
	for (let i = 0; i < SITUATION_DEF_COUNT; i++) {
		if (SITUATION_DEFS[i]?.key === key) return i + 1;
	}
	return 0;
}

/** As `situationIdByKey`, but throws rather than returning "no situation". */
export function requireSituationId(key: string): number {
	const id = situationIdByKey(key);
	if (id === 0) throw new Error(`no situation with key "${key}"`);
	return id;
}
