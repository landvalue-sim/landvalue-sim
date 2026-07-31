/**
 * A single contribution to one modifier channel.
 *
 * Policies and situation stages both say "while I am active, the world is
 * different" in this one vocabulary, which is why the type lives on its own:
 * `policy-defs.ts` and `situation-defs.ts` both depend on it and neither
 * depends on the other.
 *
 * Effects are declared in the static definition tables and never constructed at
 * runtime — the accumulate pass only ever reads them.
 */

/** Channel += value. */
export const EFFECT_ADD = 0;
/** Channel *= value. */
export const EFFECT_MULT = 1;

export interface ModifierEffect {
	/** A MOD.* channel index. */
	readonly channel: number;
	readonly kind: typeof EFFECT_ADD | typeof EFFECT_MULT;
	readonly value: number;
}

/**
 * Upper bound on how many effects one policy, stage, or approach may declare.
 * The accumulate loop is bounded by it rather than by the array length so the
 * per-tick cost stays provable no matter what content is added later.
 */
export const MAX_EFFECTS_PER_ENTRY = 8;

/**
 * Fold `effects` into `modifiers`. Additive effects are order-independent;
 * multiplicative ones commute with each other, so the result does not depend on
 * which policy or situation is visited first — which is what keeps the bus
 * deterministic as content grows.
 */
export function applyEffects(
	modifiers: Float64Array,
	effects: ReadonlyArray<ModifierEffect>,
): void {
	const limit = Math.min(effects.length, MAX_EFFECTS_PER_ENTRY);
	for (let i = 0; i < limit; i++) {
		const effect = effects[i];
		if (effect === undefined) continue;
		const current = modifiers[effect.channel];
		if (current === undefined) continue;
		modifiers[effect.channel] =
			effect.kind === EFFECT_ADD
				? current + effect.value
				: current * effect.value;
	}
}
