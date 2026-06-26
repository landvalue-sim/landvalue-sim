/**
 * Assert a condition at runtime. Throws on violation.
 * In production builds, Vite can dead-code-eliminate calls guarded by
 * `import.meta.env.DEV` at the call site, or this entire function can be
 * replaced via a define.
 */
export function invariant(
	condition: boolean,
	message: string,
): asserts condition {
	if (!condition) {
		throw new Error(`Invariant: ${message}`);
	}
}
