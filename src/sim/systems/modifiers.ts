/**
 * Modifier bus — the single narrow channel between governance and the sim.
 *
 * Policies and situations both need to say "while I am active, the world is
 * different". Letting each reach into systems directly would be a tangle of
 * cross-imports and ordering hazards, so instead they declare effects and this
 * pass folds them into `state.modifiers`. Systems read that array; nothing but
 * this file writes it.
 *
 * The whole array is **rebuilt from scratch every tick** — reset to the
 * declared bases, then accumulated over enacted policies and live situation
 * stages. Nothing is kept incrementally, so a repealed policy or a resolved
 * situation cannot leave a contribution behind, and no float drifts across a
 * long game.
 *
 * Runs at the top of the tick (right after the command processor) so a policy
 * enacted this tick is live for the rest of it. Situations, which run at the
 * bottom, therefore reach the bus one tick after they change stage — harmless
 * at a one-day tick, and far safer than making the two systems reentrant.
 */

import type { CityState } from "../city-state.ts";
import { MAX_SITUATIONS, MOD, MOD_BASE, SIT } from "../constants.ts";
import { applyEffects } from "../modifier-effect.ts";
import { POLICY_COUNT, policyDef } from "../policy-defs.ts";
import { situationDef } from "../situation-defs.ts";
import { SITUATION_NONE } from "../situation-types.ts";

export function updateModifiers(state: CityState): void {
	const { modifiers, policies, situations } = state;

	for (let i = 0; i < MOD.COUNT; i++) {
		modifiers[i] = MOD_BASE[i] ?? 0;
	}

	for (let id = 0; id < POLICY_COUNT; id++) {
		if ((policies[id] ?? 0) === 0) continue;
		const def = policyDef(id);
		if (def === undefined) continue;
		applyEffects(modifiers, def.effects);
	}

	for (let slot = 0; slot < MAX_SITUATIONS; slot++) {
		const base = slot * SIT.STRIDE;
		const def = situationDef(situations[base + SIT.DEF] ?? SITUATION_NONE);
		if (def === undefined) continue;

		const stage = def.stages[situations[base + SIT.STAGE] ?? 0];
		if (stage !== undefined) applyEffects(modifiers, stage.effects);

		// APPROACH is 1-based so that 0 can mean "none chosen".
		const approachIdx = situations[base + SIT.APPROACH] ?? 0;
		if (approachIdx > 0) {
			const approach = def.approaches[approachIdx - 1];
			if (approach !== undefined) applyEffects(modifiers, approach.effects);
		}
	}
}
