/**
 * Assert a condition at runtime. Throws on violation in dev builds.
 *
 * In production, Vite replaces `import.meta.env.DEV` with `false` and
 * the dead-code eliminator removes the throw branch entirely, leaving
 * an empty function that the engine can inline away. The `asserts`
 * return type still narrows at compile time regardless.
 */
export function invariant(
	condition: boolean,
	message: string,
): asserts condition {
	if (import.meta.env.DEV && !condition) {
		throw new Error(`Invariant: ${message}`);
	}
}
