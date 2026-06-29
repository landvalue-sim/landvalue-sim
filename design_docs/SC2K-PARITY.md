# SimCity 2000 Feature Parity Roadmap

A gap analysis between the current landvalue-sim state and SimCity 2000, organized
by priority tier. Priority reflects both how essential the feature is to a playable
city-builder experience and how much it reinforces the project's economic-simulation
thesis (land value, urbanist levers, visible economics).

**Current state summary:** The sim has a 64x64 tile grid with R/C/I zoning, roads,
a land-value field with diffusion, RCI demand feedback, migration (build/abandon at
density tier 1 only), industrial pollution, property-tax revenue, per-capita service
costs, road maintenance, a finances dialog with tax-rate sliders, an isometric
renderer with building extrusion, land-value and pollution overlays, click-and-drag
placement, camera pan/zoom, and keyboard shortcuts. There is no terrain generation,
no water/power infrastructure, no transit, no civic buildings, no disasters, no
save/load, no density progression, and no time/calendar.

---

## Priority 1 — Core Gameplay Loop (unplayable without these)

### 1.1 Power Grid
SC2K requires power plants and power lines. Without power, buildings don't develop.
- **Power plants:** Coal, natural gas, nuclear, wind, solar, hydroelectric, fusion.
  Each has a cost, output (MW), footprint, lifespan, and externalities (pollution
  for coal/gas, meltdown risk for nuclear).
- **Power lines:** 1-tile infrastructure like roads. Power conducts through roads
  and zones automatically within a radius; lines are only needed to bridge gaps.
- **Power coverage layer:** A boolean grid — tiles without power stall development.
- **Sim integration:** Migration should refuse to build on unpowered zoned land.
  Power plants age and must be replaced.

### 1.2 Water System
SC2K has water pumps, treatment plants, pipes, and desalination.
- **Water pumps/towers:** Placed near fresh water; supply capacity in gallons.
- **Pipes:** Underground 1-tile infrastructure. Water pressure falls with distance.
- **Water coverage layer:** Similar to power; low coverage lowers land value and
  slows R growth.
- **Implementation note:** Can be simplified for MVP — a single "water service"
  coverage radius from water buildings, without underground pipe routing.

### 1.3 Density Progression
Currently all buildings spawn at density tier 1 (low). SC2K buildings evolve
through 3-4 density stages based on demand, land value, and surrounding conditions.
- **Upgrade system:** Occupied low-density tiles upgrade to medium when demand
  stays high, land value exceeds a threshold, and infrastructure coverage is met.
  Medium upgrades to high under stricter conditions.
- **Downgrade/abandon:** When conditions deteriorate, buildings step down a tier
  before abandoning.
- **Visual:** Taller extrusions per tier (already partially supported by the
  `TIER_HEIGHT` constant and building layer).

### 1.4 Transportation Network
Only roads exist. SC2K has a full transport hierarchy.
- **Roads:** Already implemented. Need traffic simulation (see 2.2).
- **Highways:** Higher capacity, wider footprint (2 tiles), on/off ramps.
  Reduce commute times but consume land.
- **Rail/subway:** Fixed-route mass transit. Rail is above-ground (1-tile), subway
  is underground. Stations act as amenities that capitalize into land value.
- **Bus depots:** Low-cost transit that boosts R accessibility within a radius.
- **Connections to neighbors:** Edge-of-map road/rail/highway connections generate
  external demand and trade.

### 1.5 Time, Calendar, and Budget Cycle
The sim has a tick counter but no in-game calendar.
- **Calendar:** Map ticks to months/years. SC2K runs January-December with a
  monthly budget cycle.
- **Annual budget:** End-of-year summary showing income vs expenses with the option
  to adjust allocations. (Current per-tick finance can be reframed as monthly.)
- **Population milestones:** Unlock new building types and tools at population
  thresholds (e.g., airport at 10k, seaport at 5k).

### 1.6 Terrain Generation
Currently all-land, flat. SC2K has varied terrain.
- **Elevation/hills:** Height map layer (u8). Affects building placement cost and
  water runoff. Isometric rendering shows elevation steps.
- **Water bodies:** Rivers, lakes, coastline. Already have `TERRAIN_WATER` constant
  but no procedural generation.
- **Trees:** Decorative/environmental. Reduce pollution, slight land-value bonus.
- **Terrain editor:** Pre-game terrain sculpting mode (SC2K lets you edit terrain
  before founding the city).

---

## Priority 2 — Depth and Feedback (playable without, but shallow)

### 2.1 Civic / Municipal Buildings
SC2K has a rich set of plopped (non-zoned) buildings that provide city services.
- **Police stations:** Reduce crime in a radius. Crime is currently stubbed at zero.
- **Fire stations:** Reduce fire risk/spread in a radius.
- **Hospitals:** Increase health/life expectancy, boost R desirability.
- **Schools / colleges / libraries:** Increase education, boost C/I productivity and
  land value.
- **Parks / stadiums / zoos / marinas:** Recreation amenities that boost land value
  in a radius.
- **Each has:** A placement cost, ongoing maintenance cost (deducted in public
  finance), a coverage radius, and an effect on the relevant externality layer.

### 2.2 Traffic Simulation
Currently the `traffic` layer exists but is always zero.
- **Commute model:** R tiles generate trips to C/I tiles. Trip length and road
  capacity determine congestion.
- **Traffic layer:** Congestion per road tile, computed from commute volume vs
  capacity.
- **Effects:** High traffic lowers adjacent land value, slows growth, increases
  pollution (vehicle emissions).
- **Congestion pricing (urbanist lever):** Toll roads that shift mode share to
  transit. This is a key pedagogical feature per DESIGN.md.

### 2.3 Crime
- **Crime layer:** Driven by low land value, high density, low police coverage,
  and unemployment.
- **Effects:** Lowers R/C land value, drives abandonment.
- **Police coverage:** Civic building (2.1) that suppresses crime in a radius.

### 2.4 Fire
- **Fire risk:** Higher near industrial, in dense areas with low fire coverage.
- **Fire spread:** When a fire starts (random event or disaster), it spreads to
  adjacent flammable tiles each tick until contained.
- **Fire stations:** Coverage radius suppresses ignition and speeds containment.
- **Damage:** Fire destroys buildings, clearing the tile.

### 2.5 Education and Health
- **Education level:** Aggregate stat driven by school/library coverage. Affects
  C/I demand multiplier (educated workforce attracts commercial).
- **Health/life expectancy:** Driven by hospital coverage and pollution. Affects
  population growth rate.

### 2.6 Neighbor Connections and External Demand
- **Map edges:** Road/rail/highway connections at the map border.
- **External trade:** I zones near connections export goods (revenue bonus). C zones
  near connections attract shoppers.
- **External commuters:** Connections generate population that works in-city but
  doesn't need R housing (or vice versa).

### 2.7 Bonds and Debt
- **Bonds:** The player can issue bonds for immediate cash at the cost of annual
  repayments. SC2K allows up to ~10 outstanding bonds.
- **Interest rate:** Varies with city credit rating (based on treasury health and
  population satisfaction).
- **Bankruptcy:** Extended negative treasury triggers advisor warnings, then forced
  budget cuts, then game over.

---

## Priority 3 — Content and Polish (SC2K feel and replayability)

### 3.1 Disasters
SC2K's signature chaos events.
- **Fire:** Covered in 2.4.
- **Flood:** Water tiles overflow onto adjacent land; damages low-lying buildings.
- **Tornado:** Random path across the map, destroying buildings in its wake.
- **Earthquake:** Damages buildings city-wide, probability of fires.
- **Monster attack:** A path-following entity that destroys buildings.
- **Riots:** Low approval triggers civil unrest; damages random tiles.
- **Nuclear meltdown:** If a nuclear plant ages past its lifespan.
- **Implementation:** Each disaster is a time-limited system that runs for N ticks,
  modifying the building/road layers. Triggered randomly (seeded PRNG) or manually
  from a menu.

### 3.2 Advisors and News
- **Advisors:** Finance, transportation, city planning, public safety, utilities,
  education, health. Each provides context-sensitive text feedback.
- **News ticker:** Scrolling headlines reporting city events (milestone, disaster,
  budget issue, new building type unlocked).
- **Implementation:** A message queue read by the UI; the sim pushes events as
  side-channel data alongside the typed arrays.

### 3.3 Rewards and Special Buildings
SC2K unlocks mayor's mansion, city hall, statue, llama dome, arcologies, etc. at
population milestones.
- **Unlockable buildings:** Cosmetic or gameplay-affecting ploppables earned at
  population thresholds.
- **Arcologies:** Late-game self-contained mega-structures that house huge
  populations.

### 3.4 Land Value and Desirability Details
The current land-value model is a good start. SC2K's is richer:
- **Elevation bonus:** Higher terrain = higher land value (views).
- **Waterfront bonus:** Tiles adjacent to water get a premium.
- **Distance-to-center bonus:** Land value falls off from the city center (or from
  density clusters).
- **Crime/pollution/traffic penalties:** Already partially implemented; need crime
  and traffic layers active.
- **NIMBY effects:** Certain buildings (landfills, prisons) have large negative
  radii.

### 3.5 Map Overlays
Currently: land value, pollution. SC2K has ~12 data views.
- **Power grid coverage**
- **Water coverage**
- **Traffic density**
- **Crime rate**
- **Fire coverage / fire risk**
- **Police coverage**
- **Education coverage**
- **Health coverage**
- **Population density**
- **Growth rate (R/C/I demand per tile)**
- **Land value** (done)
- **Pollution** (done)

### 3.6 Ordinances
SC2K has ~25 city ordinances (toggleable policies) that affect the sim.
- Examples: parking fines (revenue), water conservation (reduces water demand),
  anti-pollution (reduces I pollution but raises I cost), legalized gambling
  (revenue + crime), free clinics (health + cost).
- Each ordinance: a boolean flag, an annual cost or revenue, and one or more
  multiplier adjustments on sim constants.
- **Urbanist potential:** This is a natural home for the DESIGN.md urbanist levers
  (parking minimums, congestion pricing, mixed-use zoning, density cap removal).

### 3.7 Save / Load
DESIGN.md specifies the format but nothing is implemented.
- **Local save (IndexedDB):** Serialize city state (typed arrays + aggregates) into
  the versioned binary container described in DESIGN.md.
- **Autosave:** Periodic save (every N ticks or on pause).
- **Load game menu:** List saved cities with name, population, date.
- **Cloud save (Firebase):** Stretch goal per DESIGN.md; blob in Storage, metadata
  in Firestore.

### 3.8 Multiple Map Sizes
SC2K supports small (64x64), medium (128x128), and large (256x256) maps. The
constants support up to 256x256 already (`MAX_GRID_SIZE = 256`); need UI for
choosing size at city creation.

### 3.9 Bulldozer Cost and Construction Costs
Currently zoning and roads are free. SC2K charges per tile.
- **Road cost:** Per-tile construction cost deducted from treasury.
- **Zone cost:** Small per-tile fee for zoning.
- **Demolish cost:** Small fee.
- **Infrastructure cost:** Power lines, water pipes, rails, highways all cost money.
- **Civic building cost:** Large upfront placement cost.
- **Insufficient funds:** Block placement when treasury is too low.

---

## Priority 4 — Visual and UX Polish

### 4.1 Sprite-Based Tile Art
Currently all rendering is procedural geometry (colored diamonds and extruded
boxes). SC2K uses detailed sprite tiles.
- **Tile atlas:** Sprite sheet with distinct art for each zone type x density tier,
  roads (with auto-tiling for intersections, curves, dead ends), terrain variants,
  water animation, civic buildings.
- **Road auto-tiling:** Determine correct road sprite from neighbor connectivity
  (16 configurations for 4-connected tiles).
- **Building variety:** Multiple sprite variants per zone/tier, selected by seeded
  RNG at build time for visual diversity.

### 4.2 Sound Effects and Music
- **Placement sounds:** Zone, road, demolish, civic building.
- **Ambient:** Traffic hum, birds, city bustle scaled to population.
- **Music:** Background tracks (SC2K's jazz soundtrack is iconic).
- **Disaster sounds:** Sirens, explosions, rumbling.

### 4.3 Minimap
A small overview map in the corner showing the entire city at a glance, with the
current viewport rectangle highlighted. Click-to-navigate.

### 4.4 Query Tool
Click any tile to see its detailed stats: zone type, density, land value,
pollution, crime, power/water status, owner income, trip length. SC2K's query
window is essential for understanding why tiles behave as they do.

### 4.5 Graph/Chart Panel
Historical charts showing population, treasury, crime, pollution, land value, etc.
over time. Requires storing time-series data (ring buffer of aggregate snapshots
per month/year).

### 4.6 City Name, Mayor Name, Difficulty
- **City creation screen:** Name, mayor name, difficulty (easy/medium/hard affects
  starting funds, disaster frequency, demand multipliers).
- **Score / city rating:** An aggregate satisfaction metric displayed in the UI.

---

## Implementation Order (suggested)

The tiers above are already in priority order. Within each tier, a reasonable
sequencing:

**Phase 1 — Playable loop:**
1. Construction costs and treasury checks (3.9) — quick win, adds consequence
2. Density progression (1.3) — makes growth visible and strategic
3. Power grid (1.1) — first infrastructure constraint
4. Terrain generation (1.6) — gives maps variety and strategic interest
5. Calendar and budget cycle (1.5) — frames the economic game

**Phase 2 — Strategic depth:**
6. Traffic simulation (2.2) — activates the traffic layer, enables congestion pricing
7. Civic buildings: police + fire (2.1, 2.3, 2.4) — first service/externality pair
8. Crime layer (2.3) — feedback from police coverage
9. Highways and rail (1.4) — transport hierarchy
10. Bonds and debt (2.7) — financial strategy

**Phase 3 — Content:**
11. Ordinances (3.6) — especially the urbanist-lever ordinances
12. Save/load (3.7) — essential for sessions longer than one sitting
13. Disasters (3.1) — replayability and drama
14. Advisors and news (3.2) — player feedback
15. Water system (1.2) — second infrastructure layer
16. More overlays (3.5) — as each system comes online
17. Neighbor connections (2.6)
18. Education and health (2.5)

**Phase 4 — Polish:**
19. Query tool (4.4)
20. Sprite tiles and road auto-tiling (4.1)
21. Minimap (4.3)
22. Graph panel (4.5)
23. Map size selection (3.8)
24. Rewards and arcologies (3.3)
25. Sound and music (4.2)
26. City creation screen (4.6)
