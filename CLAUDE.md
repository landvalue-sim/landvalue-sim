# CLAUDE.md — landvalue-sim

## Project

Economic city simulator (browser-based, TypeScript). Deterministic sim core runs in a Web Worker; Phaser 4 render shell on main thread; shared state via SharedArrayBuffer flat typed arrays. See `DesignDocs/DESIGN.md` for full architecture.

## Stack

TypeScript, Phaser 4, React + React Aria, Vite, Vitest, Biome, zod, Firebase (Auth/Firestore/Storage).

## Code Rules

This project follows NASA Power of 10 rules adapted for TypeScript in a real-time simulation context. All code must be human-readable, statically analyzable, and performant.

### 1. Simple control flow

- No recursion. Use explicit loops or iterative algorithms. The call graph must be acyclic and statically verifiable.
- Prefer `for` loops over chained higher-order functions (`map`/`filter`/`reduce`) in hot paths. Chaining is fine in cold setup code.
- No `goto`-equivalents: avoid labeled breaks, labeled continues, and complex exception-driven control flow.

### 2. Fixed upper bounds on all loops

- Every loop must have a provable upper bound. Use `for (let i = 0; i < MAX; i++)` not `while (condition)` in simulation code.
- Define iteration limits as named constants (`MAX_TILES`, `MAX_AGENTS`, `MAX_ITERATIONS`).
- `while` loops are acceptable only when guarded by a decrementing counter or bounded by a known-finite data structure size.

### 3. No dynamic memory allocation after initialization

- Simulation-core code must not allocate objects or arrays during the tick loop. Pre-allocate all buffers, pools, and scratch arrays at startup.
- Use object pools and typed arrays. No `new` in hot paths.
- UI/shell code is exempt from this rule — React can allocate normally.

### 4. Functions are short

- Functions should not exceed ~60 lines of logic (excluding type declarations and blank lines). If longer, decompose.
- Each function does one thing. Name it for what it does, not how.

### 5. Minimize data hiding — assert liberally

- Use assertions (`console.assert` or a lightweight `invariant()` helper) to check preconditions, postconditions, and invariants in development builds.
- Strip assertions in production via dead-code elimination (Vite define).
- Never silently swallow errors. If a condition is unexpected, assert or throw — do not return a default.

### 6. Declare data at the smallest scope

- Variables are declared at the narrowest possible scope. No top-level mutable module state outside of explicit singletons.
- Prefer `const` over `let`. Never use `var`.
- Simulation state lives in typed arrays, not scattered mutable variables.

### 7. Check all return values

- Every function return value must be used or explicitly voided (`void fn()`) if intentionally discarded.
- Enable `@typescript-eslint/no-floating-promises` and `noUncheckedIndexedAccess` in tsconfig.
- No ignored Promise rejections. All async code must handle errors.

### 8. Limit preprocessor / metaprogramming

- No code generation, `eval`, `new Function`, or template-literal-based DSLs at runtime.
- Generics are fine but keep type-level computation simple — no deeply recursive conditional types.
- Decorators are banned. Use plain functions and composition.

### 9. Restrict pointer / reference usage

- No `any`. Use `unknown` and narrow with type guards.
- No type assertions (`as`) except at validated system boundaries (e.g., after zod parse).
- No non-null assertions (`!`). Narrow properly or assert.
- Prefer value types (numbers, typed arrays) over object references in simulation core.

### 10. Compile clean at maximum strictness

- `strict: true` in tsconfig with all strict sub-flags enabled.
- `noUncheckedIndexedAccess: true`.
- Biome lint and format must pass with zero warnings before commit.
- All code must compile with zero TypeScript errors and zero Biome warnings.
- Treat warnings as errors in CI.

## Simulation-Specific Rules

- **Determinism:** Never use `Math.random()`, `Date.now()`, or any non-deterministic API in simulation code. Use the seeded PRNG.
- **Thread safety:** Simulation core writes to SharedArrayBuffer; render shell reads. No shared mutable state outside the SAB. Use Atomics where ordering matters.
- **Tick budget:** Each simulation tick must complete within its time budget. Profile regularly. If a system is slow, optimize the algorithm — do not skip the system.
- **Data layout:** Grid state is flat typed arrays indexed `y * width + x`. No per-tile objects. No `Map` or `Set` in hot paths.

## File & Naming Conventions

- Files: `kebab-case.ts` (e.g., `land-value.ts`, `rci-demand.ts`).
- Types/interfaces: `PascalCase`. Prefer `interface` for object shapes, `type` for unions/intersections.
- Functions/variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for true compile-time constants; `camelCase` for derived values.
- Enums: use `const enum` or plain object-as-const (`as const`) — never runtime enums.

## Testing

- Vitest for all tests. Simulation core must have deterministic unit tests.
- Test file location: colocated `*.test.ts` next to source.
- Assert on exact numeric outputs where possible (deterministic sim makes this feasible).
- No mocks in simulation tests — the sim core has no external dependencies by design.

## Commit & PR Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `perf:`, `chore:`.
- Keep commits atomic — one logical change per commit.
- Run `biome check` and `vitest run` before committing.

## What Not To Do

- Do not add runtime dependencies to the simulation core package.
- Do not use `class` for data. Use plain objects and typed arrays.
- Do not introduce circular imports. The dependency graph is: `sim-core` -> nothing; `shell` -> `sim-core`; `ui` -> `shell`.
- Do not optimize without profiling first. Measure, then fix.
