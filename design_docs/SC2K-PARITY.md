# SimCity 2000 Feature Parity Roadmap

A gap analysis between the current landvalue-sim state and SimCity 2000, organized
by priority tier. Priority reflects both how essential the feature is to a playable
city-builder experience and how much it reinforces the project's economic-simulation
thesis (land value, urbanist levers, visible economics).

**Current state summary:** The sim has a 64×64 tile grid with R/C/I zoning at three
player-controlled density levels (Low/Med/High), roads, rail, power lines, a
land-value field with diffusion (including road/rail/waterfront/elevation bonuses and
power/water coverage penalties), RCI demand feedback, migration with density
upgrades, industrial and coal-plant pollution, property-tax revenue, per-capita
service costs, road/rail/civic maintenance, a finances dialog with tax-rate sliders
and power/water stats, an isometric renderer with building extrusion, land-value,
pollution, power, and water overlays, click-and-drag placement, camera pan/zoom,
keyboard shortcuts, procedural terrain generation (elevation + water bodies via
value noise), a power grid (BFS flood fill with progressive disclosure), a water
system (radius coverage from pumps with progressive disclosure), civic buildings
(coal plant, solar plant, water pump), construction costs with treasury checks, and
a calendar (1 tick = 1 month).

---

## ~~Priority 1 — Core Gameplay Loop~~ DONE

All Priority 1 systems have been implemented:

- ~~1.1 Power Grid~~ — **Done.** Coal and solar plants, BFS flood fill, brownout,
  progressive disclosure.
- ~~1.2 Water System~~ — **Done.** Water pumps with radius coverage, must be adjacent
  to water, progressive disclosure.
- ~~1.3 Density Progression~~ — **Done.** Player-controlled density (Low/Med/High per
  zone type), buildings upgrade toward cap when demand is high.
- ~~1.4 Transportation: Rail~~ — **Done.** Rail as 1-tile infrastructure, conducts
  power, boosts land value.
- ~~1.5 Time/Calendar~~ — **Done.** 1 tick = 1 month, displayed as month/year.
- ~~1.6 Terrain Generation~~ — **Done.** 3-octave value noise, elevation + water.
- ~~1.7 Construction Costs~~ — **Done.** All placements deduct from treasury; commands
  rejected on insufficient funds.

### Remaining P1 gaps (stretch)
- **Power plant variety:** Only coal and solar exist. SC2K has gas, nuclear, wind,
  hydro, fusion — each with unique cost/output/lifespan/externalities.
- **Power plant aging:** Plants should degrade and eventually need replacement.
- **Highways:** Higher-capacity 2-tile roads with on/off ramps. Not yet started.
- **Bus depots:** Low-cost transit amenity. Not yet started.
- **Neighbor connections:** Edge-of-map road/rail connections for external demand.
- **Annual budget cycle:** End-of-year summary with allocation adjustments.
- **Population unlock milestones:** Airport at 10k, seaport at 5k, etc.

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
The land-value model already includes road/rail/waterfront/elevation bonuses,
commercial/population neighbor effects, industrial/pollution penalties, and
power/water coverage penalties. Remaining SC2K details:
- **Distance-to-center bonus:** Land value falls off from the city center (or from
  density clusters).
- **Crime/traffic penalties:** Need crime and traffic layers active (see 2.2, 2.3).
- **NIMBY effects:** Certain buildings (landfills, prisons) have large negative
  radii.

### 3.5 Map Overlays
Current overlays: land value, pollution, power grid, water coverage.
Remaining SC2K data views:
- **Traffic density**
- **Crime rate**
- **Fire coverage / fire risk**
- **Police coverage**
- **Education coverage**
- **Health coverage**
- **Population density**
- **Growth rate (R/C/I demand per tile)**

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
SC2K supports small (64×64), medium (128×128), and large (256×256) maps. The
constants support up to 256×256 already (`MAX_GRID_SIZE = 256`); need UI for
choosing size at city creation.

---

## Priority 4 — Visual and UX Polish

### 4.1 Sprite-Based Tile Art
Currently all rendering is procedural geometry (colored diamonds and extruded
boxes). SC2K uses detailed sprite tiles.
- **Tile atlas:** Sprite sheet with distinct art for each zone type × density tier,
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

Priority 1 is complete. Remaining work:

**Phase 2 — Strategic depth:**
1. Traffic simulation (2.2) — activates the traffic layer, enables congestion pricing
2. Civic buildings: police + fire (2.1, 2.3, 2.4) — first service/externality pair
3. Crime layer (2.3) — feedback from police coverage
4. Highways (P1 stretch) — transport hierarchy
5. Bonds and debt (2.7) — financial strategy

**Phase 3 — Content:**
6. Ordinances (3.6) — especially the urbanist-lever ordinances
7. Save/load (3.7) — essential for sessions longer than one sitting
8. Disasters (3.1) — replayability and drama
9. Advisors and news (3.2) — player feedback
10. More overlays (3.5) — as each system comes online
11. Neighbor connections (2.6)
12. Education and health (2.5)
13. More power plant types (P1 stretch)

**Phase 4 — Polish:**
14. Query tool (4.4)
15. Sprite tiles and road auto-tiling (4.1)
16. Minimap (4.3)
17. Graph panel (4.5)
18. Map size selection (3.8)
19. Rewards and arcologies (3.3)
20. Sound and music (4.2)
21. City creation screen (4.6)
