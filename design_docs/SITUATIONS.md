# Situations

Status: **design, not built.** Split out of the former `INFLUENCE-AND-SITUATIONS.md` when
the currency design was reworked. The mechanics here survived that rework largely intact;
what changed is what situations cost and pay out in — see `INFLUENCE-AND-BUDGET.md`.

This describes the plumbing, not the content. The roster stays deliberately tiny — three
or four — until the mechanics have been played with.

## Why they exist

A currency needs a sink, and a sink needs to be something the player *wants* to spend on.
Influence without situations is a bar that fills up; situations without influence are
cutscenes. The loop is:

```
city state  →  a situation triggers  →  it applies modifiers that hurt
            →  the player spends influence on an approach
            →  the approach changes the situation's progress rate
            →  the situation resolves or worsens  →  city state
```

Situations are also the **delivery mechanism for the budget's future-eating levers**. The
pension liability, the maintenance backlog, and the sold-off revenue stream do not punish
the player through a slowly worsening number — they punish through a named condition that
arrives years later with a progress bar and a price. That is what makes a deferred cost
feel like a consequence rather than an accounting adjustment.

## What a Stellaris situation is, and what we keep

A situation is a named, ongoing condition with a **progress bar** that moves on its own,
**stages** that gate escalating effects, and **approaches** the player picks to change how
fast, and in which direction, the bar moves. It is not an event popup with three buttons —
it persists, it is visible the whole time, and the player's choice is a standing
commitment rather than an instant.

That is exactly the right shape for a city sim, because a city's problems are
*conditions*, not incidents. A housing shortage is not a moment; it is eighteen months of
rents outrunning wages while you decide whether to spend the political capital to fix it.

What we drop for now: per-approach random outcomes, multiple simultaneous approaches, and
district-scoped situations. All can be layered on later without changing the slot layout.

## Content is data, not code

Situations are authored in **`situations.json`** and compiled into runtime definitions by a
loader at module load. Adding, retuning, or removing a situation means editing the
template and nothing else.

The template speaks in the units a person thinks in — string keys, whole percentages,
channel names — and the runtime speaks in dense ids, milli-percent, and array indices.
Translating between them is the loader's whole job. That split is worth a file of
validation, because content can then be written and reviewed without reading any
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
one earns its keep: an author who writes a zero-drift situation and forgets to give it an
approach has created a permanent debuff with no way out, and would otherwise not find out
until it fired in play.

## The template

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
              "influence": -10, "operating": -2500, "opens": "housing-collapse" },
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

**Money outcomes name a fund.** An outcome charges `operating` or `capital`, never
"treasury" — there is no such thing. A crisis that eats the operating fund and a windfall
that lands in the capital fund are completely different events, and the template has to be
able to say which. Most bad outcomes hit operating, because that is where a city actually
bleeds.

**Influence figures in the template are authored as numbers and displayed as none.** The
loader keeps exact integers; the UI renders every cost and payout as a segment of the
meter (see `INFLUENCE-AND-BUDGET.md`, *The meter*). Authoring in numbers is not in tension
with hiding them — it is the same split as everywhere else, designer units in, player
feel out.

## Triggers are data, not predicates

A trigger could be a callback, but a table of function pointers makes the call graph
non-static, which the code rules rule out, and it would put arbitrary logic on the monthly
evaluation path. A comparison against an aggregate keeps evaluation to a bounded loop of
comparisons, and when a trigger genuinely wants something that is not an aggregate, the
answer is to publish that number as an aggregate — which is where it belonged anyway.

This is also why the budget's liabilities are aggregates rather than derived values: the
Pension Cliff triggers on `PENSION_LIABILITY` crossing a line, and it can only do that if
the liability is a real number in the buffer.

Triggers are evaluated **monthly**, not per tick, and a definition already occupying a
slot cannot re-trigger. The PRNG is rolled only when the line is crossed, so an uneventful
month consumes no randomness.

## Direction, and what happens at each end

Progress runs `0 … 100` and drifts by `baseProgressPerMonth + (approach?.progressPerMonth
?? 0)` each month. **`baseProgressPerMonth` is signed**, and each end of the bar is
independently either a wall or an exit:

| `kind` | Behaviour |
| --- | --- |
| `"pin"` | Progress clamps at that end and the situation stays open, effects live |
| `"resolve"` | The outcome fires once and the slot is freed |

An outcome is a one-off influence swing, a one-off swing against a named fund, and
optionally `opens` — the key of a follow-on situation. That last field is what carries
lasting consequence without a separate "permanent modifier" store: a follow-on with no
trigger, no drift, and one expensive approach *is* a lasting consequence, expressed with
machinery that already exists.

Those knobs cover the range the system needs:

- **Fix it or it gets worse** — positive drift, `resolve` at both ends with different
  outcomes. Housing Crunch: reach 0 and you are thanked, reach 100 and the operating fund
  takes a hit and the city inherits Housing Collapse.
- **It only ends badly** — positive drift, `pin` at the top. Fiscal Emergency does not
  conclude; it sits at Insolvency until you do something.
- **Enjoy it while it lasts** — negative drift. Construction Boom opens at 100% and fades
  on its own; its one approach *raises* progress, buying time rather than fixing anything.
- **Aftermath** — zero drift, no trigger, one costly approach. Housing Collapse does not
  heal by itself. That is the point of it.

A follow-on is **queued, not opened inline**. Opening it during the advance pass would
drop it into a slot the pass has not reached yet, handing it a free month of drift on the
very tick it was created. The queue is a pre-allocated `Int32Array`, flushed after the
pass.

## Slot pool

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

Progress is an integer in thousandths of a percent so accumulating it is exact —
repeatedly adding a float delta to a float bar drifts, and a bar that stops one
ten-thousandth short of resolving is the kind of bug that only shows up after an hour of
play. Integers make the boundary condition an exact comparison.

`Int32Array` rather than `Uint32Array` because deltas are signed and an underflow is much
easier to catch as a negative number than as four billion.

`AGG.SITUATION_COUNT` mirrors the number of occupied slots so the HUD does not have to
scan the pool every frame.

## Groundwork roster

Chosen so that between them they exercise every shape above: Housing Crunch (two-ended,
chains), Housing Collapse (aftermath, no trigger), Fiscal Emergency (pins), Construction
Boom (negative drift, an approach that prolongs it). They are here to prove the machinery,
not to be a content set.

The liability-driven situations — Pension Cliff, Infrastructure Failure, and whatever the
monetisation regret is called — are the first real content, and they are what the system
is actually for. They wait until the budget exists to trigger off.

### The chains worth building first

Two chains are worked out enough in `INFLUENCE-AND-BUDGET.md` to author directly, and
between them they prove that situations can carry a consequence across decades.

**The revenue chain**, which is the speed-trap path and the best test of the system because
every step of it is historically documented:

```
Enforcement Ramp        trigger: fine share of revenue crosses a line, rising
   ├─ resolves down →   quietly wound back, small influence cost, no scar
   └─ resolves up   →   opens Community Fracture (district standing collapses)
                             └─ opens State Scrutiny
                                  ├─ resolves down → cap accepted, revenue permanently lower
                                  └─ pins at max  → Revenue Cap Imposed, excess clawed back
                                                     └─ opens Disincorporation Review
```

Note the shape: the first situation is *cheap to fix and easy to ignore*, and each
following one is harder and more expensive than the last. The player is never ambushed —
they are given four separate chances to stop, and the reason they do not take them is that
stopping costs revenue they are relying on. That is the correct emotional structure for
every liability chain in the design.

**The pension chain**, which is the same shape stretched over a much longer time and is
therefore the harder authoring problem:

```
Contribution Slipping   trigger: funded ratio falls below a band
   └─ (no fast resolution — drift is slow and the approaches are expensive)
        └─ Crowding Out      the contribution starts visibly displacing services
             └─ Pension Cliff  amortization exceeds current-service cost
```

`Pension Cliff` should have **no approach that fixes it quickly**, because there is not
one in reality — accrued benefits cannot be cut, and the reform the player can pass
applies to new hires and saves nothing for twenty years. Its approaches are all forms of
enduring it. A situation that cannot be solved, only carried, is unusual and worth having
exactly once.

Both chains need the aggregates they trigger off — fine revenue share, funded ratio — to
exist as real numbers in the buffer, which is the argument in *Triggers are data* applied
to the budget's liabilities.

### The deadline fork — a situation with no good approach

One scenario is worth authoring early because it stresses a part of the template nothing
else does: a situation where **every approach is bad and refusing to pick is worse.**

Pittsburgh, 2010. The city pension fund sat at **29.3% funded** against a state law
requiring 50% by 31 December or the Commonwealth would take the fund over and impose much
larger contributions. The mayor's answer was to lease the parking system — twelve garages
and 9,000 meters — for **$451.6M up front**. City Council rejected it, and at the deadline
passed the alternative: irrevocably dedicate **$735.7M of parking tax revenue from 2011 to
2041** to the pension fund, move $45M out of debt service reserves, and raise meter and
garage rates to cover the resulting hole.

Both options are the same move — monetising thirty years of parking to dodge a takeover.
Council's version counted the present value of a pledged future revenue stream as a
*present pension asset*, clearing 50% without a dollar of new money coming into existence.

As a situation:

```
Takeover Deadline       trigger: funded ratio below the statutory line
                        drift:   positive and fast — this one has a clock
  approach A  Sell the asset      → large capital injection now,
                                    operating revenue lost permanently
  approach B  Pledge the revenue  → no cash, counts as an asset, requires a
                                    rate rise that costs faction standing
  no approach → resolves at max   → opens Oversight Board
```

Three things it proves out. **A situation can have a clock** — fast positive drift with a
`resolve` at the top is a deadline without any new machinery. **Approaches can both be
losses**, which the current template already supports and the groundwork roster never
exercises. And **the do-nothing path is a real option** that leads somewhere specific
rather than to a stalemate, because falling into oversight is survivable and, per
`INFLUENCE-AND-BUDGET.md`, even carries compensations.

It also does something the rest of the roster cannot: it makes the player perform the
exact accounting manoeuvre the design is about, and understand while doing it that they
are choosing which future to spend.

## Tick order

Situations run at the **bottom** of the pipeline, after every system has published its
aggregates, so a trigger reads this tick's numbers rather than last tick's. The modifier
bus is rebuilt at the **top**, so a policy enacted by a command this tick is live for the
rest of it.

A stage change therefore reaches the modifier bus on the following tick — a one-tick lag,
which is harmless at a one-day tick and much safer than making the two systems mutually
reentrant.

## Determinism and persistence

- Trigger rolls use the existing seeded PRNG. Same seed and same commands still give the
  same city.
- All situation state lives in the shared buffer, so it is inside the save payload for
  free once persistence lands.
- `modifiers` is derived, not authoritative. It is in the buffer only so the UI can read
  it without a message round-trip; loading a save recomputes it on the first tick.

## UI surface

Situations appear in the Governance dialog: name, progress bar, current stage, how long it
has been running, and the approach buttons with their costs shown against the influence
meter. No new overlay — situations are city-wide, not spatial. When a spatially-scoped
situation exists (a contaminated district, say), that is when an overlay earns its place.

## Testing

Deterministic unit tests, exact numbers, colocated:

- **Loader** — one case per rejection, each breaking exactly one field of an otherwise
  valid entry, so it proves the loader caught *that* field. Plus the conversions:
  percentages to milli-percent, channel and aggregate names to indices, a cross-reference
  to a key declared later in the file.
- **Runtime** — a trigger fires only when its aggregate crosses and the roll succeeds; a
  null-trigger situation never fires; an already-open definition does not re-trigger; the
  pool refuses a ninth situation; drift works in both directions and at zero; stage
  thresholds pick the right stage; each end resolves or pins as its template says; an
  outcome pays out into the fund it names, clamps, and chains; a chained situation gets no
  free drift on the month it opens.

## Explicitly out of scope

No per-approach random outcomes, no district-scoped situations, no branching on city state
at the moment of resolution. Chaining exists but only in its simplest form — one outcome
opens one follow-on. Branching, and outcomes that open different situations depending on
which approach was standing, are the obvious next steps and both fit the existing template
shape.
