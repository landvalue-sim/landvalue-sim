# Notes: "Making my dream city builder" (jamessimo)

Source: three transcripts in `design_docs/jamessimo_transcripts/`, covering a solo dev
building a **gridless, parcel-driven city builder** in a custom WebGPU engine.

- Part 1 — Parcels (the gridless thesis)
- Part 2 — Traffic (mesoscopic LTM on compute shaders)
- Part 3 — City Simulation (stocks & flows, cellular automata, pops, districts)

His project and this one disagree on the single biggest axis: he is anti-grid, we are
a flat-typed-array grid by design. That disagreement is narrower than it looks. Almost
everything he says about *simulation* is representation-agnostic, and the small number
of things that genuinely need polygons have grid-native equivalents. This document
separates the two: what he's actually claiming, and which parts survive the translation.

---

## 1. The gridless thesis (Part 1)

### The complaint

Grid-based builders waste land. In Cities: Skylines, a block that isn't a perfect
rectangle leaves **"no man's land"** — slivers between buildings that no property owns.
Real cadastral maps have no such gaps: every square inch of a block is claimed by
*some* parcel, and parcels are freely triangular, pentagonal, or L-shaped.

Grid problems are also **scale problems**. His examples:

- A power plant in CS is a building next to a house. Real plants sit inside a huge
  parcel with cooling towers, a coal reservoir, offices, a car park, often their own
  fire station, plus a mandatory safety buffer.
- Elementary schools render smaller than two houses.
- Stadiums are visibly out of scale with the sims walking around them.

He notes Will Wright deliberately omitted parking because it "made the game boring" —
defensible for a fixed-zoom isometric game, much less defensible once you can zoom to
street level.

### The system he built

Two years of work on a standalone parceling engine (not the game):

1. **Player draws roads**, then paints a **parcel** — an arbitrary polygon.
2. The parcel is **subdivided into lots** by one of several algorithms. The main one is
   a **straight-skeleton subdivision** ("skeleton v2"), from a 2012 Purdue-et-al paper
   on procedural urban parcel generation. He notes the paper is pseudocode-only and
   "very handwavy" — he never fully replicated it.
3. Alternative subdividers: OBB (oriented bounding box) recursive splitting, and
   **Voronoi** for farmland and irregular rural land.
4. **Minimum lot area is a parameter** — smaller lots = cheaper, denser housing. This
   is the player's (or developer's) affordability dial.
5. **Offset / setback is a parameter** too, and doing this at the parcel level is how
   he gets **courtyard blocks** (his "Barcelona is confirmed" demo): a large parcel with
   a big interior offset produces a perimeter block with a hole in the middle.
6. Each lot knows **which edge faces the road** (debug arrows show road direction).
   Buildings orient to the road by default, but the intent is that they can instead
   orient to a view — seaside, a landmark — when that's worth more.
7. Buildings are then procedurally generated **into** the lot, and can adapt their
   footprint to odd lot shapes (demonstrated with office blocks).
8. Parks use **flow fields** to route internal paths. He notes big apartment complexes
   and office blocks also need internal paths — buildings are not opaque blobs.

Zoning types he's testing against: residential, commercial, industrial, office, rural,
**mixed use**, public/institution, parks, public works, public transit.

### The developer-agent framing

This is the interesting design idea underneath the geometry, and it's fully portable:

> The player zones. A **property developer** decides what to actually do with the land.

The developer looks at what the parcel *has access to* and builds accordingly:

- Waterfront residential → jetties, and more of them for affluent lots.
- Waterfront restaurant/hotel → beach amenities.
- Waterfront industrial → an actual dock, if given enough water frontage.
- Big flat inland parcel → condominium towers with internal parks, playgrounds,
  parking (the aerial-photo-of-China example).
- Affluent lots → pools, driveways to the house.

And services **grow into their land**: a water treatment plant starts small, expands to
meet demand as the city grows, and eventually saturates its parcel. At that point the
city must either site a second one or grant the existing one more land. Utilities
therefore have a *land budget*, not just a build cost.

Housing pressure has a downward tail as well: if newcomers can't get suitable housing,
he wants **trailer parks** to form naturally, and is investigating unused land being
**squatted** into shanty towns depending on local demographics.

He also wants the game to model non-Western urban form — the developer-buys-superblock-
and-builds-forty-identical-towers pattern, not just European fine-grained blocks.

---

## 2. Traffic (Part 2)

### The three tiers

| Tier | What it simulates | Example |
|---|---|---|
| **Macroscopic** | Statistical flows; vehicles are cosmetic | SimCity 4 |
| **Mesoscopic** | Aggregate flow/density **per link** | ← his choice |
| **Microscopic** | Per-vehicle agents with behavior | Cities: Skylines |

He is explicit that CS's microscopic traffic is *good* — "honestly, no notes" — but
that per-agent cost is a hard ceiling on city size, and rebuilding it would just be
"making City Skylines but worse."

### Link Transmission Model (LTM)

His pick. Roughly 1950s-vintage kinematic-wave theory (LWR), with a modern paper
extension for realism and compute savings. The framing:

> **Simulate flow, not drivers.** Roads are pipes. Traffic is a compressible fluid.

What this buys, that a static "spread load along a path" model cannot:

- **Kinematic waves** — congestion propagates *backwards* from the bottleneck.
- **Standing queues** at capacity constraints.
- **Acceleration fans** as a jam discharges.
- **Stop-and-go waves**.
- **Congestion has inertia.** In his demo, adding a three-lane arterial does not clear
  the jam instantly: "those people are still in congestion," and they only re-enter the
  population once they've drained out. This is the single most important behavioural
  difference from an equilibrium model.

### Dynamic Traffic Assignment (planned, not built)

- A **bimodal curve** over the day to produce morning and evening peaks, giving a
  day/night rhythm without any per-agent scheduling.
- **Route choice responds to current conditions**, not just static geometry — i.e.
  rerouting under congestion, which is where induced demand and rat-running come from.

### Modes and pedestrians

Pedestrians and bicycles are first-class, not decoration. In his stress-test city,
people on the outskirts walk to nearby commercial while people in the core drive,
purely because of distance — an emergent mode-share gradient. In Part 3 he says he
brought the pathing system "on par with the traffic system" so a walkable/bikeable old
town works with **zero cars**.

Road types are skinnable (his American/European toggle) with the intent that road
types are **data**, addable by players or modders, with meshes adapting.

### Engine notes

- Everything — traffic, terrain, rendering — runs on **WebGPU compute shaders**.
  "Nothing here is using the CPU."
- The **entire road network is one mesh**, one draw call, with light chunking.
- Buildings use **GPU instancing**; a whole stress-test city holds 60 FPS.
- **Terrain is a matrix** and edited as a compute shader — "GPUs love matrices."
- A **buildability overlay** marks unbuildable cliffs and water.
- Clicking a parcel reports **area, % buildable, % water, % slope** — and different
  zone types / developers have different tolerances for those numbers.

---

## 3. City simulation (Part 3)

### The core claim

> There is no *one* simulation of a city. It is **layers upon layers** of systems woven
> into a single experience.

Unlike a flight simulator or the LTM traffic model — each a single known formula — a
city has no closed form. He lists ~20 interacting systems: services, politics, zoning,
food, electricity, markets, buildings, land value, water, economy, work, raw resources,
consumer goods, workers, investment, developers, supply chains, public transport,
pedestrians, freight, traffic.

### Lineage 1 — Urban Dynamics / stocks and flows

Forrester, *Urban Dynamics* (1969), later generalized as system dynamics. Influential
on Will Wright.

The bathtub model:

- **Inflow**: births, in-migration, new houses, new businesses.
- **Stock** (the water level): people, jobs, houses.
- **Outflow**: deaths, out-migration, demolition, business failure.

The rule that matters:

> **You never write the stock. You only change the rates going in and out.**

He argues this is also realistic: a new city policy rarely reaches back and changes the
people already there — it changes who arrives, who leaves, and how fast.

Forrester's model is deliberately **aspatial**: it's about the life cycle of a city's
structures and people, not about geography or travel time.

### Lineage 2 — Cellular automata / map algebra

Will Wright's "cellular dynamics." Data as a 2D grid, simple local rules, e.g. an
industrial tile emits pollution 100 and each cell passes 25% of its value to empty
neighbours until exhausted.

His worked example: arterial road 50, minor roads 25, industry 100, **park negative** —
so the park actively pulls pollution out of the road beside it.

The key move, which he says mattered *more* to SimCity than Forrester did:

> Compute a pollution field, compute a land-value field, then **overlay them and do
> arithmetic vertically**. Same-shaped arrays, add/subtract/multiply. Extremely cheap,
> and it produces numbers that feel right.

SimCity simulated population **tile by tile** on these layers, with fully abstract
population — no individuals followed. Its known compromises: after work, sims returned
to the *nearest vacant home* rather than their own, and buses and subways acted as
teleports. He's forgiving — this ran on a Pentium III.

### Lineage 3 — Agent-based simulation

*Growing Artificial Societies* (1996), the earliest agent-based reference he found;
notable for also covering spatial simulation (how do you make a city work when zones
are genuinely far apart) and social rules.

An agent carries: type (student / low- or high-income worker / retired), a job with a
world destination, a preferred transit mode, a salary, plus position and model.

His verdict on CS's agents: emergent, believable, and it makes bad decisions produce
real traffic. But there's a per-agent cost, and — echoing commenters — *the simulation
often doesn't feel like it meaningfully punishes or rewards the player's choices*.
Attention lands on how agents get around rather than on whether your infrastructure
decisions were right. His phrase: **infrastructure decisions don't feel load-bearing.**

### Lineage 4 — LLM-powered agents

He surveys three recent papers: per-agent LLMs choosing transport and schedules,
LLM personas for social interaction, and one giving LLMs to *institutions* (government,
households, production, investment). His verdict is a flat no —

> "I can't think of a more cursed game mode than: you can play my game, and there is a
> token cost for how long you play my game."

Noted here for completeness. Not a direction.

### Spatial queries: KD-trees

Binary space partitioning, in games since Doom. Used for "how many shops within 5 km,"
"how many trees are nearby." He assumes every city simulator uses one and would
question any that doesn't.

### The gravity model, and the sink inversion

Universal in city builders. An agent (or pop group) at home needs a job and has two
candidates. The counter-intuitive implementation detail:

> It is **cheaper to have employers pull workers** than to have each worker choose a
> job. The workplaces are gravitational **sinks**; the pop gets pulled toward whichever
> field is stronger.

Sink strength derives from vacancy, land value, building rating, and (in agent models)
travel time.

**His open problem:** when two jobs are identical in occupancy, land value, and
distance, a naive gravity model resolves it with a coin flip. He finds that
unsatisfying. His fix: a sink shouldn't score itself in isolation — it should
**reference its surroundings**, i.e. its **district**, and the district's own score
feeds the pull.

His illustration: two 5 km-equidistant job offers, one on the outskirts and one toward
the centre. Real people take the central one — higher salaries, more opportunity, more
social mobility. A pure distance-and-vacancy gravity model can't express that, and he
doesn't think many city simulators model it at all.

### Pops instead of headcounts

Victoria 2/3-style **cohorts**. A pop is a statistical group defined by profession,
culture, religion, residence, and workplace, carrying standard of living, wealth, and
qualifications, and able to migrate. Explicit motivation: **pops should congregate** —
real neighbourhoods have character, often dictated by the local industry.

Additional population classes he wants:

- **Tourists** — significant for cities with natural points of interest.
- **External commuters** — if your city lacks educated workers or seasonal labour, they
  commute in from outside.
- **Economic migrants** — arrive for work, add pressure you must absorb.
- **The homeless** — he's deliberately cautious here, citing SimCity (2013)'s badly
  received homelessness system as what not to do.

### District-level RICO — his flagship idea

Standard builders expose one citywide RCI/RICO demand meter. Two complaints:

1. **R is always first.** He thinks **C and I should lead**: in the modern world people
   move *for the job*. We aren't simulating homesteaders building a house and waiting
   for a town.
2. **Citywide RICO is restricting** — and he thinks it's *why you build one city per
   map* rather than a region of distinct towns.

His alternative: the map **auto-partitions into districts**, and **each district has its
own RICO**, its own schools, hospitals, police, and transit access. Districts still
reference each other. Pops then migrate *between districts* for jobs and for **school
quality** — which is what people actually do.

Payoffs he calls out:

- A lumber yard on the city limits grows a **logging town** around it, not another
  generic urban blob.
- District identity can drive **building appearance and feel**.
- Statistics get more meaningful per district: food self-sufficiency, waste handling.
- It simplifies the maths — districts are the aggregation unit.

His demo (older than the parceling engine): paint residential, mixed-use, commercial,
industrial, utilities, and farmland; press start; labelled circles settle onto the map
having **automatically grouped parcels into districts** — and correctly classifying a
residential area with some commercial in it as *residential*, not mixed.

### Other systems in flight

- **Demand-driven cargo**: industries ship to each other, with downstream demand chains.
- **Movement between districts and POIs** runs on the LTM + DTA traffic system.
- **Irreversible extraction**: parcel off land for mining or oil and the terrain is
  literally dug into a quarry. You get money and an influx of workers, and eventually
  you own a large hole and the problem of what to do with it.
- Setting: roughly the **current year**. Start blank, or inherit a **failing old town**
  to modernize. He dislikes that builders start "now" and then run 150 years, and hasn't
  solved it. No far-future; drone delivery and autonomous cars are "pie in the sky."

---

## 4. Process notes (worth stealing independently of any mechanic)

- **Subsystem-first.** Parceling engine, traffic engine, and district sandbox are three
  separate prototypes. None of them is the game. The game is assembled later.
- **Everything documented in markdown as he goes**, explicitly so the project is
  transferable to a team or a successor. (Same instinct as `design_docs/` here.)
- **Blue-sky first, then scope.** From consulting: enumerate every possibility before
  cutting, "I don't want to leave anything on the floor."
- **Stated build order:** population + economy → traffic that plays well with it → a
  "lo-fi game loop" (traffic + population + parcel subdivision together) → basic
  procedural buildings → *then* look for funding and a team.
- **Read the papers, expect them to be handwavy.** He got his core subdivision
  algorithm from a paper with no code and never fully reproduced it.
- **He hasn't forgotten fun.** Explicit worry that fundamentals-first work is dry;
  wants a game his kid will play.

---

## 5. Translation to a grid-based sim

Sorted by value-per-unit-effort for this project. `→` names the file that would change.

### Directly portable — the representation is irrelevant

| Idea | Grid form |
|---|---|
| **Stocks and flows discipline** | Systems adjust *rates*; stock layers change only through bounded per-tick flows. `MAX_BUILDS_PER_TICK` and friends already are this — the invariant just isn't stated. → `sim-invariants.ts`, `migration.ts` |
| **Layered map algebra** | Already the architecture. Per-layer fields combined arithmetically is exactly `land-value.ts` reading pollution/traffic/coverage. Confirmation, not a change. |
| **District-level RICO** | Districts are connected components of zoned + road-adjacent tiles — a label pass over the grid, cheap and deterministic. Per-district demand replaces three citywide scalars. → `rci-demand.ts` + a new `districts.ts` |
| **C and I lead R** | `rci-demand.ts` already derives `targetPop = totalJobs × RESIDENTS_PER_JOB`, so R is job-led. Worth making the ordering explicit in the docs rather than accidental. |
| **Gravity via employer sinks** | Job tiles get a pull score (vacancy × land value × district score); residential tiles are pulled. Replaces the current "every R tile trips to every job in radius, unweighted." → `traffic.ts` |
| **District score breaks gravity ties** | Directly answers his open problem, and gives centrality a voice: a job in a strong district out-pulls an identical job on the fringe. → `districts.ts` |
| **Pops as cohorts** | Per-*tile* cohort vectors would blow the memory budget; per-*district* cohort shares (profession, education, wealth) over the existing per-tile headcount is the affordable version, and districts are already the aggregation unit. |
| **External commuters / tourists / migrants** | Pure aggregate inflow terms. No spatial representation needed at all. → `migration.ts` |
| **Time-of-day demand curve** | Scale trip generation by a bimodal curve over a tick-phase counter. Congestion pulses; land value near arterials responds. Cheap. → `traffic.ts` |
| **Downstream cargo demand** | Industry-to-industry demand chains are stock-and-flow bookkeeping, not geometry. |
| **Irreversible extraction** | `terraform.ts` + `vertexHeights` already make a quarry expressible: extraction lowers vertices permanently and leaves a remediation cost. |
| **"Infrastructure decisions must feel load-bearing"** | The sharpest design critique in the three videos, and it aligns with this project's stated goal of making levers *visible and testable*. Worth adopting as an explicit design test: for every lever, can the player see the delta? |

### Needs translation — the polygon version has a grid equivalent

- **Traffic: LTM → cell transmission on the road layer.** The mesoscopic idea survives
  translation perfectly; a **cell transmission model** *is* a cellular automaton over
  road cells, which is the most grid-native thing in these videos. Each road tile (or
  each segment between junctions) carries density and flow; the update is a local
  sending/receiving-capacity rule. That gets queues, backward-propagating shock waves,
  and congestion inertia. The current `traffic.ts` is a static gravity smear with no
  time dimension and no queueing — a jam clears the instant you add a road. This is
  probably the single largest fidelity upgrade available, and it fits the existing
  fixed-tick, typed-array, deterministic architecture without a WebGPU rewrite.

- **KD-tree → prefix sums and distance transforms.** On a uniform grid, "how many jobs
  within radius r" is a summed-area table or a separable sweep, not a tree.
  `traffic.ts` already builds per-column prefix sums. Worth hoisting into a shared
  spatial-query module rather than re-deriving it per system.

- **Buildability → a suitability layer.** He reports % buildable / % water / % slope per
  parcel. On a grid this is per-tile, derived from `vertexHeights` and `waterLevel`, and
  it's nearly free: slope is the spread of a tile's four corners. Feeds land value,
  gates growth, and renders directly as an overlay.

- **Parcel setback / minimum lot area → density-and-coverage parameters.** His lot-size
  dial is an affordability dial. The grid analogue is per-tile lot coverage and floor
  area ratio riding alongside `densityCap` — the same lever, expressed as a number
  instead of a polygon.

- **Buildings needing land → multi-tile footprints with buffers.** His power-plant
  complaint is not really about polygons; it's that a plant should claim a *field*, not
  a lot. On a grid that's an n×m footprint plus a required buffer of low-value or
  unbuildable tiles. Same lesson, no geometry needed.

- **Services growing into their land.** A civic building holding a land budget and
  expanding its footprint until saturated works identically on a grid, and it's a nicer
  loop than "place a second one." Pairs with `civic-coverage.ts`.

- **Developer chooses what to build from what the site has access to.** On a grid the
  site's "access" is just the neighbourhood read of existing layers — waterfront,
  transit-adjacent, high land value, park-adjacent. This turns building selection from
  a density-tier lookup into a site-appropriateness choice, which is most of the visual
  variety he gets from polygons, for a fraction of the work.

### Doesn't transfer — and mostly doesn't need to

- **Straight-skeleton / OBB / Voronoi subdivision.** The whole point is irregular
  polygons; a grid has no irregular parcels to subdivide. The *consequence* of gridless
  parceling (no wasted no-man's-land) is also a non-issue here — grid tiles tile
  perfectly by construction. This is the one place where the grid is straightforwardly
  the better answer for our goals.

- **WebGPU-everything.** His compute-shader architecture is driven by needing a very
  large gridless world at 60 FPS. Our sim is a Web Worker over a SharedArrayBuffer, and
  `DESIGN.md` already flags land-value diffusion as the natural first WebGPU candidate
  *if* it ever bottlenecks. Measure before moving.

- **Road-facing orientation and view-seeking buildings.** Partially applicable — a grid
  building can still face its adjacent road, and a waterfront-facing sprite variant is
  cheap — but the underlying geometry problem doesn't exist for us.

- **LLM agents.** Agreed; not a direction.

### The one strategic disagreement worth holding onto

He treats the grid as the root cause of the genre's problems. Most of what he actually
fixes, though, is downstream of three separable choices that a grid does not force:
uniform building footprints, citywide aggregate demand, and equilibrium traffic. This
project can take the second and third wholesale, and take most of the first via
multi-tile footprints — while keeping the flat typed arrays, deterministic tick, and
exact-value tests that make the economics testable in the first place.
