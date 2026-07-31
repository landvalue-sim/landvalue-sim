# Influence and Situations

Status: **groundwork design**. This describes the plumbing, not the content. Everything
here is scoped so that the systems, data model, and tests exist and are correct, while the
actual roster of policies and situations stays deliberately tiny (two or three of each)
until the mechanics have been played with.

See `DESIGN.md` for the surrounding architecture. The rules in `CLAUDE.md` apply
throughout: no allocation in the tick loop, fixed loop bounds, no `Math.random`, flat
typed arrays in the shared buffer.

## Why these two together

They are one feature, not two. Influence without a sink is a number that goes up;
situations without a currency to spend on them are cutscenes. The loop is:

```
city state  →  a situation triggers  →  it applies modifiers that hurt
            →  the player spends influence on an approach
            →  the approach changes the situation's progress rate
            →  the situation resolves or worsens  →  city state
```

Influence is the *political capital* of running a city: the goodwill and standing that
lets a mayor do something other than build. Money buys concrete. Influence buys
permission. Both are needed for a government action; that separation is the point.

## Part 1 — Influence

### The resource

A single scalar, stored in the aggregates, accrued on the same weekly cadence as public
finance, and capped. Stellaris caps influence at a low number on purpose: it makes the
resource about *choosing*, not about hoarding. We do the same.

| Aggregate | Meaning |
| --- | --- |
| `AGG.INFLUENCE` | Current stock, `0 … MAX_INFLUENCE` |
| `AGG.INFLUENCE_INCOME` | Last settlement's gross weekly accrual (readout only) |
| `AGG.INFLUENCE_UPKEEP` | Weekly influence committed to standing policies and approaches |

`MAX_INFLUENCE = 1000`, `STARTING_INFLUENCE = 100`.

### Accrual

Deliberately **O(1)**. Public finance already pays for a full-grid pass each week and
there is no reason to buy a second one. Everything the accrual formula needs is an
aggregate some earlier system has already computed:

```
income = INFLUENCE_BASE_PER_WEEK                        (a flat 5)
       + educationLevel / 100 * INFLUENCE_EDUCATION_BONUS
       + healthLevel    / 100 * INFLUENCE_HEALTH_BONUS
       - min(crimeShare, 1)   * INFLUENCE_CRIME_PENALTY
       + MOD.INFLUENCE_INCOME_ADD
income = max(0, income)

stock = clamp(stock + income - upkeep, 0, MAX_INFLUENCE)
```

`crimeShare` is `TOTAL_CRIME` normalised against population so a big city is not
automatically ungovernable — a large, well-policed city should not be worse off than a
small one with the same crime *rate*.

The shape of this is the design statement: **an educated, healthy, safe city grants its
government room to act.** Neglect the services and you keep the tax base but lose the
ability to do anything with it.

### Insolvency

If upkeep exceeds stock at settlement, the city cannot pay for its standing commitments.
Rather than let influence go negative, policies are **automatically repealed, most
recently enacted first**, until upkeep fits. This is a bounded loop over the policy table,
it is deterministic, and it is legible to the player ("you overcommitted, the newest thing
you promised is what got dropped"). A repeal caused this way is not refunded.

"Most recently enacted" needs an order, and a bare enacted/not flag does not carry one. So
the policy byte stores a **dense rank** instead: `0` = not enacted, otherwise `1 … n` in
enactment order. Enacting renumbers the ranks compactly, which is a bounded double loop
over a table that will stay small, run only on the rare event of a player enacting
something. The alternative — a monotonic counter — needs an overflow path that would
almost never execute and therefore almost never be right.

### Government actions (policies)

The first sink. A policy is a standing ordinance: an up-front influence cost, a recurring
weekly influence upkeep, and a set of modifier effects that apply for as long as it is
enacted.

Policies live in a **static definition table** (`policy-defs.ts`) — plain `as const` data,
module-level, never allocated at runtime. Enacted state is a `Uint8Array` in the shared
buffer, one byte per policy, so both threads can read it. The byte is a rank rather than a
flag; see *Insolvency* below.

Groundwork roster (three, purely to exercise the plumbing):

| Policy | Cost | Upkeep | Effect |
| --- | --- | --- | --- |
| Upzoning Mandate | 60 | 3/wk | `R_DEMAND_ADD +60` |
| Austerity Budget | 40 | 2/wk | `MAINTENANCE_MULT ×0.85`, `R_DEMAND_ADD −25` |
| Civic Outreach | 50 | 0/wk | `INFLUENCE_INCOME_ADD +3` |

Commands: `enact-policy { policyId }`, `repeal-policy { policyId }`. Like `set-tax-rate`,
these touch aggregates only, journal nothing, and report no change — a policy is standing
government policy, not a map edit, so it must survive an undo and must not trigger a world
rebake.

## Part 2 — Situations

### What a Stellaris situation is, and what we keep

A situation is a named, ongoing condition with a **progress bar** that moves on its own,
**stages** that gate escalating effects, and **approaches** the player picks to change how
fast, and in which direction, the bar moves. It is not an event popup with three buttons —
it persists, it is visible the whole time, and the player's choice is a standing commitment
rather than an instant.

That is exactly the right shape for a city sim, because a city's problems are
*conditions*, not incidents. A housing shortage is not a moment; it is eighteen months of
rents outrunning wages while you decide whether to spend the political capital to fix it.

What we drop for now: per-approach random outcomes, multiple simultaneous approaches, and
district-scoped situations. All can be layered on later without changing the slot layout.

### Content is data, not code

Situations are authored in **`situations.json`** and compiled into runtime definitions by
`situation-loader.ts` at module load. Adding, retuning, or removing a situation means
editing the template and nothing else.

The template speaks in the units a person thinks in — string keys, whole percentages,
channel names — and the runtime speaks in dense ids, milli-percent, and array indices.
Translating between them is the loader's whole job. That split is worth a file of
validation because it means content can be written and reviewed without reading any
TypeScript, and because the units a designer wants ("12% a month") are not the units the
sim wants.

The template is a plain `import`, so it is bundled at build time. There is no fetch, no
runtime parsing cost, and no way for the game to start with content that failed to load.

**Validation is hand-rolled, not zod.** The sim core takes no runtime dependencies — that
is what keeps it portable and headless-testable — and zod is a runtime dependency. The
trade is that every field is checked by hand, so the rule is: no field is read without
being validated, and every failure throws with the path that caused it. A bad template
fails at import, which means it fails every test and the dev server's first load, rather
than at the moment that situation happens to trigger an hour into a game.

The loader rejects, among others: unknown aggregate or channel names, a stage list that
does not start at 0 or does not ascend, a cross-reference to a key that does not exist, a
duplicate key, a trigger chance of 0 (that is what a null trigger is for — saying it two
ways invites one of them to be wrong), and **a situation that could never end**. That last
one is the check that earns its keep: an author who writes a zero-drift situation and
forgets to give it an approach has created a permanent debuff with no way out, and would
otherwise not find out until it fired in play.

### The template

```json
{
  "key": "housing-crunch",
  "name": "Housing Crunch",
  "description": "…",
  "trigger": {
    "aggregate": "R_DEMAND",     // any AGG.* name
    "op": "above",               // "above" | "below"
    "value": 700,
    "chancePerMonth": 0.3
  },
  "startProgress": 20,           // percent; optional
  "baseProgressPerMonth": 12,    // percent, signed
  "atZero": { "kind": "resolve", "name": "Shortage Eased", "influence": 15 },
  "atMax":  { "kind": "resolve", "name": "Housing Collapse",
              "influence": -10, "treasury": -2500, "opens": "housing-collapse" },
  "stages": [
    { "at": 0,  "name": "Rising Rents",
      "effects": [{ "channel": "R_DEMAND_ADD", "op": "add", "value": -20 }] }
  ],
  "approaches": [
    { "name": "Emergency Permitting", "description": "…",
      "influenceCost": 80, "influenceUpkeep": 4, "progressPerMonth": -30,
      "effects": [{ "channel": "R_DEMAND_ADD", "op": "add", "value": 40 }] }
  ]
}
```

Ids are assigned from array order and are what the pool stores; code that needs a specific
situation asks for it by key (`requireSituationId("housing-crunch")`), so a renamed key
fails loudly at startup instead of silently matching nothing.

`"trigger": null` marks a situation that can never fire on its own — it exists only to be
opened as another situation's outcome.

### Triggers are data, not predicates

A trigger could be a callback, but a table of function pointers makes the call graph
non-static, which the code rules rule out, and it would put arbitrary logic on the monthly
evaluation path. A comparison against an aggregate keeps evaluation to a bounded loop of
comparisons, and when a trigger genuinely wants something that is not an aggregate, the
answer is to publish that number as an aggregate — which is where it belonged anyway.

Triggers are evaluated **monthly**, not per tick, and a definition already occupying a
slot cannot re-trigger. The PRNG is rolled only when the line is crossed, so an uneventful
month consumes no randomness.

### Direction, and what happens at each end

Progress runs `0 … 100` and drifts by `baseProgressPerMonth + (approach?.progressPerMonth
?? 0)` each month. **`baseProgressPerMonth` is signed**, and each end of the bar is
independently either a wall or an exit:

| `kind` | Behaviour |
| --- | --- |
| `"pin"` | Progress clamps at that end and the situation stays open, effects live |
| `"resolve"` | The outcome fires once and the slot is freed |

An outcome is a one-off `influence` swing, a one-off `treasury` swing, and optionally
`opens` — the key of a follow-on situation. That last field is what carries lasting
consequence without a separate "permanent modifier" store: a follow-on with no trigger, no
drift, and one expensive approach *is* a lasting consequence, expressed with machinery that
already exists.

Those three knobs cover the range the system needs:

- **Fix it or it gets worse** — positive drift, `resolve` at both ends with different
  outcomes. Housing Crunch: reach 0 and you are thanked, reach 100 and the city eats a
  treasury hit and inherits Housing Collapse.
- **It only ends badly** — positive drift, `pin` at the top. Fiscal Emergency does not
  conclude; it sits at Insolvency until you do something.
- **Enjoy it while it lasts** — negative drift. Construction Boom opens at 100% and fades
  on its own; its one approach *raises* progress, buying time rather than fixing anything.
- **Aftermath** — zero drift, no trigger, one costly approach. Housing Collapse does not
  heal by itself. That is the point of it.

A follow-on is **queued, not opened inline**. Opening it during the advance pass would drop
it into a slot the pass has not reached yet, handing it a free month of drift on the very
tick it was created. The queue is a pre-allocated `Int32Array`, flushed after the pass.

### Slot pool

A fixed pool of `MAX_SITUATIONS = 8` slots, stored as an `Int32Array` in the shared buffer
with a stride of six fields:

| Field | Meaning |
| --- | --- |
| `SIT.DEF` | Definition id, `0` = empty slot |
| `SIT.PROGRESS` | Fixed-point milli-percent, `0 … 100_000` |
| `SIT.STAGE` | Index of the live stage |
| `SIT.APPROACH` | `0` = none, else 1-based index into the def's approaches |
| `SIT.START_TICK` | Tick the situation opened, for the UI's "ongoing since" |
| `SIT.LAST_DELTA` | Last month's progress change, milli-percent, readout only |

Progress is an integer in thousandths of a percent so that accumulating it is exact —
repeatedly adding a float delta to a float bar drifts, and a bar that stops one
ten-thousandth short of resolving is the kind of bug that only shows up after an hour of
play. Integers make the boundary condition an exact comparison.

`Int32Array` rather than `Uint32Array` because deltas are signed and an underflow is much
easier to catch as a negative number than as four billion.

`AGG.SITUATION_COUNT` mirrors the number of occupied slots so the HUD does not have to
scan the pool every frame.

### Groundwork roster

Four situations, chosen so that between them they exercise every shape above: Housing
Crunch (two-ended, chains), Housing Collapse (aftermath, no trigger), Fiscal Emergency
(pins), Construction Boom (negative drift, an approach that prolongs it). They are here to
prove the machinery, not to be a content set.

## Part 3 — The modifier bus

Situations and policies both need to say "while I am active, the world is different."
Letting each of them reach into systems directly would be a mess of cross-imports and
ordering hazards. Instead there is one narrow channel between them and the sim.

`state.modifiers` is a `Float64Array` of named channels, **recomputed from scratch every
tick** — reset to base, then accumulated over enacted policies and live situation stages.
No incremental bookkeeping, so there is no drift and no leak when something is repealed or
resolves. Systems read it and never write it.

Channels wired in the groundwork:

| Channel | Base | Read by |
| --- | --- | --- |
| `R_DEMAND_ADD` / `C_DEMAND_ADD` / `I_DEMAND_ADD` | 0 | `rci-demand.ts` |
| `TAX_REVENUE_MULT` | 1 | `public-finance.ts` |
| `MAINTENANCE_MULT` | 1 | `public-finance.ts` |
| `INFLUENCE_INCOME_ADD` | 0 | `influence.ts` |

Every one of these is read **O(1)** — at the top of a system, or once per weekly
settlement. That is not an accident: a channel that has to be consulted per tile costs a
multiply across 65,536 tiles every tick whether or not anything is modifying it. Per-tile
channels (a land-value multiplier, a fire-risk multiplier) are the obvious next additions
and are cheap enough, but they should be added one at a time with a profile behind each,
per the "measure, then fix" rule. The groundwork deliberately ships none.

Adding a channel is: add the index to `MOD`, add its base to `MOD_BASE`, read it where it
belongs. The reset/accumulate loops are data-driven and do not change.

## Tick order

```
 1. commands
 2. modifiers          ← new: reset, accumulate policies + live situation stages
 3. power … 13. public finance     (unchanged)
14. influence          ← new: weekly accrual, upkeep, insolvency repeals
15. situations         ← new: monthly triggers, progress, stages, resolution
16. invariants
```

Modifiers are rebuilt at the *top* of the tick so a policy enacted by a command this tick
is live for the rest of it. Situations run at the *bottom*, after every system has
published its aggregates, so a trigger reads this tick's numbers rather than last tick's.
A stage change therefore reaches the modifier bus on the following tick — a one-tick lag,
which is both harmless at a one-day tick and much safer than trying to make the two
systems mutually reentrant.

`applyEdits` rebuilds the modifiers **unconditionally**, not inside its `changed > 0`
branch. Enacting a policy moves no tile, so — like a tax change — it reports no change and
must not trigger a world rebake; but the bus still has to pick it up, or a policy enacted
while the sim is paused would sit inert until the next tick, which may never come. The
rebuild is a few dozen operations, so running it on every edit batch costs nothing.
`refreshDerived` deliberately does *not* call it: nothing journaled can change a policy or
a situation, so an undo cannot change the modifiers.

## Determinism and persistence

- Trigger rolls use the existing seeded PRNG through `nextFloat`. Same seed and same
  commands still give the same city.
- All new state (influence stock, policy flags, situation slots) lives in the shared
  buffer, so it is inside the save payload for free once persistence lands. The buffer
  layout gains three sections; `cityByteLength` accounts for them, and the existing
  layer-count tests pin it.
- `modifiers` is derived, not authoritative. It is in the buffer only so the UI can read
  it without a message round-trip; loading a save recomputes it on the first tick.

## Buffer layout

Sections stay ordered by decreasing alignment so each starts naturally aligned:

```
aggregates  f64  [AGG.COUNT]
modifiers   f64  [MOD.COUNT]          ← new
rng         u32  [4]
situations  i32  [MAX_SITUATIONS * SIT.STRIDE]   ← new
u16 layers  u16  [3 * size]
u8 layers   u8   [21 * size]
vertex      u8   [(w+1) * (h+1)]
policies    u8   [POLICY_COUNT]       ← new
```

The situation pool is `Int32Array` rather than `Uint32Array` because progress deltas are
signed and it is easier to catch an underflow as a negative number than as four billion.

Total added: 8 × `MOD.COUNT` + 4 × 48 + `POLICY_COUNT` bytes — under 300, against a ~1.7 MB
buffer for a 256×256 map. Not worth optimising.

## UI surface

Groundwork only, matching what already exists rather than inventing a new visual language:

- **HUD:** influence stock and weekly net, beside the treasury.
- **A Governance dialog** modelled on `FinancesDialog`: influence breakdown, the policy
  list with enact/repeal buttons, and the active situations with their progress bars,
  current stage, and approach buttons.

No new overlay. Situations are city-wide, not spatial; when a spatially-scoped situation
exists (a contaminated district, say) that is when an overlay earns its place.

## Testing

Deterministic unit tests, exact numbers, colocated:

- `modifiers.test.ts` — every channel resets to its declared base; enacting two policies
  that touch one channel accumulates; repealing removes the contribution completely.
- `influence.test.ts` — accrual formula against hand-computed values; the cap holds; the
  floor holds; insolvency repeals newest-first and stops as soon as upkeep fits.
- `situation-loader.test.ts` — one case per rejection, each breaking exactly one field of
  an otherwise-valid entry so it proves the loader caught *that* field. Plus the
  conversions: percentages to milli-percent, channel and aggregate names to indices, a
  cross-reference to a key declared later in the file.
- `situations.test.ts` — a trigger fires only when its aggregate crosses and the roll
  succeeds; a null-trigger situation never fires; an already-open definition does not
  re-trigger; the pool refuses a ninth situation; drift works in both directions and at
  zero; stage thresholds pick the right stage; each end resolves or pins as its template
  says; an outcome pays out, clamps, and chains; a chained situation gets no free drift on
  the month it opens.
- `tick.test.ts` — the end-to-end wiring: a policy enacted through a command rebuilds the
  bus without triggering a rebake, and the systems downstream actually read it.
- `city-state.test.ts` — extended so the new sections are covered by the existing
  "buffer is big enough" assertions.

## Explicitly out of scope

Named for the sake of the next person reading this: no per-approach random outcomes, no
district-scoped situations, no influence from neighbour connections or diplomacy, no
per-tile modifier channels, no save/load migration (persistence does not exist yet), no
advisor/notification feed.

Chaining exists but only in its simplest form — one outcome opens one follow-on. Branching
on city state at the moment of resolution, or an outcome that opens different situations
depending on which approach was standing, are the obvious next steps and both fit the
existing template shape.
