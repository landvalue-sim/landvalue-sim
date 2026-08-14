# Influence and the Budget

Status: **design, not built.** This is the intended shape of the game's economy, written
before the implementation so the implementation has something to be judged against. The
code currently on `feat/influence-and-situations` predates this revision and diverges from
it in several places — see *Divergence from the current branch* at the end.

See `DESIGN.md` for the surrounding architecture and `SITUATIONS.md` for the system that
delivers the consequences described here. The rules in `CLAUDE.md` apply throughout.

## The thesis

**Money is constrained by law. Influence is constrained by politics. The game lives where
those two constraints disagree.**

A city government is not a firm. It cannot move money to where money is most useful, it
cannot spend a windfall on whatever it likes, and the things that keep it in office are
not the things that keep it solvent. Most city-builders model a mayor as a business owner
with one bank balance, which quietly removes every decision that makes municipal finance
interesting.

So the design has two halves that are deliberately mismatched:

- **Influence is the main currency.** It is what the player actually spends to *do*
  things. It is scarce, it is slow to accrue, and it is never shown as a number.
- **Money is a constraint, not a score.** It is split into two funds that cannot pay for
  each other's problems, and it is shown to the dollar.

The pleasure we are aiming at is the pleasure of the genuinely weird decision — building a
new library on borrowed money in the same year you cut the hours of the three you already
have, and understanding exactly why you did it.

### One shape, six times

Every mechanism in this document is the same move: **borrow capacity from the future, pay
it back in sovereignty.**

| Lever | Borrows | Repaid with |
| --- | --- | --- |
| Bonds | Money | Operating capacity, forever |
| Pension underfunding | Labour | A liability that compounds at the assumed return |
| Deferred maintenance | The asset | Capital replacement, sooner than you planned |
| Revenue monetisation | Future revenue | That revenue, permanently |
| Fines and fees | Legitimacy | State intervention |
| Faction favours | Influence | Policy concessions you do not choose |

And every failure state is also the same shape: **you never lose the city, you lose
levers.** A control board, a hostile council, a state cap on fine revenue, a faction lien
— each leaves the map exactly as it was and takes away the player's ability to act on it.
That is the fail state this genre can actually use, because it does not destroy the thing
the player spent forty hours building. Sovereignty is the health bar, not the city.

## Part 1 — Influence

### What it is

Influence is political capital: the standing, goodwill, and accumulated favours that let a
mayor do something other than the obvious. It is the answer to "can I get away with this?"

**Money pays for the thing. Influence pays for the permission.** Concrete costs money.
Pouring it somewhere a neighbourhood does not want it costs influence.

### What costs influence

The rule is not "government actions cost influence" — it is that **anything overriding
someone's interests costs influence, and anything routine costs none.** Laying a road
across empty grassland is administration. Laying the same road through a built-up block is
a fight.

| Category | Examples |
| --- | --- |
| Overriding land interests | Upzoning an established neighbourhood, condemnation, demolishing occupied buildings, running infrastructure through built-up land |
| Siting the unwanted | Landfill, incinerator, jail, shelter, transfer station — cost scales with the land value and population it lands on |
| Changing the fiscal settlement | Raising a tax rate, cutting a service, adopting a deficit budget, issuing debt past a routine threshold |
| Committing the future | Long bonds, revenue monetisation, breaking the wall between the two funds |
| Standing ordinances | Policies, which charge up front and then recur |
| Responding to situations | Approaches, which charge up front and then recur |

Note what is *not* on the list: building on vacant land, ordinary maintenance, zoning
greenfield, laying pipe. A city builder that charged influence for those would just be a
city builder with a second money bar.

### What grants influence

| Source | Character |
| --- | --- |
| Service quality — education, health, safety | The accrual rate. Slow, structural, compounding. |
| Ribbon cuttings — completing a visible capital project | Lumpy, immediate, and *aimed at the wrong behaviour on purpose* (see Part 3) |
| Resolving a situation well | The reward loop for engaging rather than enduring |
| Adopting a balanced operating budget on time | Small, annual, and easy to lose |

The accrual formula stays **O(1)**, computed from aggregates other systems have already
published. Public finance already buys a full-grid pass each week; there is no reason to
buy a second one.

```
rate = base
     + educationLevel × EDUCATION_WEIGHT
     + healthLevel    × HEALTH_WEIGHT
     - crimeShare     × CRIME_WEIGHT          (crime normalised against population,
                                               so a big well-policed city is not
                                               automatically ungovernable)
     + MOD.INFLUENCE_RATE_ADD
```

The shape of that formula is the design statement: **an educated, healthy, safe city
grants its government room to act.**

And it sets up the central bind. Services are an *operating* expense. The operating fund
is the one that gets squeezed. So the first thing a cash-strapped player reaches for —
cutting services — is also the thing that reduces their capacity to fix anything else.
The trap closes slowly and it closes fairly.

### The meter — no numbers

Influence is displayed as **an unnumbered meter**. Never a figure, never a per-week rate,
never a cost in digits. The sim holds an exact integer for determinism and testing; the UI
simply refuses to print it.

```
  STANDING   ██████████▒▒▒▒▒▒▒░░░░░░░░░░░░░░░  ▲
             ├ committed ┤├ cost ┤
             ├──────────── in hand ──────────┤
```

Three things are legible at a glance and none of them is a number:

1. **Committed** (solid) — how much of the bar standing obligations already claim. This
   is the readout that keeps overcommitment from being a surprise.
2. **Cost preview** (hatched) — when the player hovers or focuses an action, its price
   appears as a segment measured against *their own bar*. Costs are therefore always
   compared to capacity, which is the only comparison the decision actually needs.
3. **Drift** — a chevron and a slow fill or drain, so the direction and rough speed are
   felt rather than read.

A coarse verbal band (*Spent · Precarious · Steady · Strong · Commanding*) gives the state
a name for tooltips, notifications, and screen readers. Bands are wide enough that they
cannot be reverse-engineered into a number by watching them tick over.

**Why no numbers.** Four reasons, in order of how much they matter:

1. **A number invites optimisation; a bar invites judgment.** We want the player asking
   "can I afford this fight?", not computing a break-even against a wiki table.
2. **It is honest to the fiction.** No mayor knows their exact political capital. They
   know roughly how much room they have, and they find out they were wrong by trying
   something.
3. **It keeps the design retunable.** Exact costs get memorised and shared; a meter can be
   rebalanced without invalidating what players have learned to feel.
4. **It makes the contrast the point.** Money is auditable to the dollar. Influence is
   not. The two halves of a government's problem *should* read differently, and showing
   one as a ledger and the other as a gauge says that without a word of text.

**Risks, honestly.** Hiding numbers is a real cost and the mitigations have to be built,
not assumed:

- *Tradeoffs become illegible.* Mitigated by the cost-preview segment, and by keeping the
  number of simultaneous sinks small enough to hold in the head.
- *The player cannot plan precisely.* This is intended, but only up to a point — the
  committed segment must be crisp and always visible, because being unable to plan is
  interesting while being ambushed by your own past commitments is not.
- *Debugging and tuning need the real value.* A dev-only overlay prints the integer. The
  shipped UI never does.

### Cap and rate are upgradeable

Both halves of the resource grow, and they grow differently.

**Cap ("standing") — how much the office can hold.** Shown as the meter physically
lengthening: new segments unlock and the bar gets longer, so growth is felt as *new room
to act* rather than as a bigger number. Sources are structural and rare — charter reform,
an electoral mandate at a term milestone, a landmark civic achievement, resolving a major
situation at its good end.

**Rate — how fast it refills.** Driven by the service formula above, plus specific
policies and civic institutions.

The intended arc: early on the player can barely afford one fight a year and has to choose
which one. Late on they can run several campaigns at once — and by then the situations
they are managing are correspondingly larger. A low cap is not a tutorial phase to be
escaped; it is what makes the first fifty decisions matter.

### Insolvency

If standing commitments exceed the stock at settlement, the city cannot pay for what it
has promised. Influence does not go negative. Instead commitments are **automatically
dropped, most recently taken on first**, until the remainder fits.

Newest-first is legible ("you overcommitted; the newest promise is what broke") and it
requires an enactment order, so the stored state per commitment is a **dense rank** rather
than a boolean flag: `0` for inactive, otherwise `1…n` in the order taken on. Enacting
renumbers compactly — a bounded double loop over a small table, run only on the rare event
of the player enacting something. The alternative, a monotonic counter, needs an overflow
path that would almost never run and therefore would almost never be correct.

A commitment dropped this way is not refunded.

## Part 2 — The two-layer budget

Money splits into two funds that **cannot pay for each other's problems**. This is the
rule that generates every good decision in the system, so it is worth stating flatly
before the detail: *the wall between the funds is the feature.*

### The operating fund

Recurring, and it has to balance — **on paper.**

| In | Out |
| --- | --- |
| Property tax | Salaries — service staffing levels |
| Fees and charges | Maintenance |
| Fines | Debt service |
| Intergovernmental transfers | Pension contribution |

#### Balance is a requirement to *adopt*, not to *achieve*

This is the most important thing municipal finance does that a game usually flattens away.
Nearly every US state requires a city to **adopt** a balanced budget. Almost none require
it to **end the year** balanced. The gap between those two sentences is where a whole
category of decisions lives, and it is free to model: budget adoption checks the *plan*,
and the plan is built on revenue assumptions the player chooses.

So the player balances the budget by being optimistic, and then the year happens.

#### The gimmick ladder

When the year goes wrong, cities do not simply overspend. They climb a ladder of
increasingly disreputable one-time fixes, and the ladder is the interesting object —
every rung works, every rung is legal, and every rung is worse than the one above it.

| Rung | Move | Cost |
| --- | --- | --- |
| 1 | Draw down the rainy-day reserve | Reserve depth is watched; going thin is the first thing that moves a rating |
| 2 | Short-term borrowing against expected revenue | Cheap, routine, has to be repaid inside the year |
| 3 | Deferrals — push a payroll date past year end, slow-walk vendors | Pure timing; next year inherits it |
| 4 | Skip or shave the pension contribution | Free today. See *the three future-eating levers* |
| 5 | "Scoop and toss" — refinance to push principal out and cut this year's debt service | Borrowing to cover operating costs, laundered through the debt schedule |
| 6 | Sale-leaseback of a city asset | One-time cash for a permanent obligation |
| 7 | Raid an enterprise fund via an "administrative overhead charge" | Breaking the wall (see below) with paperwork |
| 8 | Hiring freezes, furloughs, service cuts | The only rung that actually fixes anything, and the one that costs influence and throttles accrual |

A reserve, therefore, is not a number the player maintains for safety — it is **rungs of
ladder they have not yet had to climb.**

#### What actually disciplines the player

Not a rule. **The credit rating.** It is slow, it is visible, it is expensive, and it
responds to reserve depth, deficit history, and liability load rather than to any single
action. A downgrade raises the cost of every future bond, which shrinks the capital fund,
which is where all the fun was. That is a far better disciplining mechanism than a hard
stop, because the player can see it coming for years and choose to keep going.

Below the rating, the escalation ladder is **oversight**, covered in Part 4.

### Fees, fines, and the speed-trap path

Fees and fines are a first-class revenue lever, and they are the most politically seductive
one on the board: they raise operating money without a tax rise, from a population that is
not the median voter.

They are also the sharpest illustration of borrowing legitimacy. Enforcement intensity is
a slider, and pushing it:

1. Raises operating revenue immediately, at **no influence cost** — nobody organises
   against a speed limit.
2. Falls unevenly. The revenue comes from specific districts, and the residents of those
   districts are a faction whose standing drops as enforcement rises.
3. Attracts the state. Once fine revenue passes a share of the general fund, the state
   notices.

The historical spine is exact enough to build from. Ferguson, Missouri drew north of 20%
of general fund revenue from fines and fees. Missouri's **Macks Creek Law** — named for a
town on US-54 that ran a notorious speed trap — caps the share of municipal revenue that
may come from traffic fines; after Ferguson it was cut to 20% statewide and 12.5% in St.
Louis County, with everything above the cap remitted to the state school fund. Georgia and
Texas have their own versions. Macks Creek itself eventually **disincorporated** — the
town stopped legally existing.

That gives a complete situation chain with a real ending: *revenue works → a district
turns → the state imposes a cap and claws back the excess → refuse to adapt and the
question becomes whether the city is a city.* Disincorporation is the furthest point on
the sovereignty ladder, and it should be reachable, rare, and survivable only as a warning
the player gets years in advance.

### The capital fund

Lumpy, restricted, and it cannot pay a single salary.

| In | Out |
| --- | --- |
| Bond proceeds | Construction |
| Grants | Land and asset acquisition |
| Land sales | One-time capital assets |
| Capital reserves | Local match on grants |

### The wall, and breaking it

Capital money cannot fund operating shortfalls. That is the law, and it is why a city can
be simultaneously building a convention centre and laying off librarians — the money for
the first legally cannot pay for the second.

The player **can** break the wall anyway, because real governments find ways to. A fund
transfer is available, costs a great deal of influence, and carries a real chance of
opening an oversight situation (an auditor, a state control board) that constrains
borrowing for years. It should be a lever the player reaches for in genuine desperation
and regrets about a third of the time.

### The coupling that makes it a trap

**Every capital project creates an operating tail.** A park built with bond money needs
mowing and staff forever. A rail line needs operators. A new library needs librarians.

Each buildable therefore declares an operating cost alongside its capital cost, and the UI
shows the tail *at the moment of purchase* — not buried in a report. The player is told,
plainly, what they are signing up for.

They should do it anyway. That is the design working. The capital fund is flush, the
ribbon cutting pays influence today, and the operating consequence arrives quarterly for
thirty years. The capital budget can look healthy for a decade while the operating budget
is slowly strangled by everything that budget built.

**Debt service is an operating line.** Issuing bonds relieves capital pressure by
increasing operating pressure. There is no version of borrowing that does not make next
year harder, and the player should be able to feel the ratchet.

### The three future-eating levers

Each converts present relief into a future crisis. Each is cheap, legal, and widely used
by real cities. Each is delivered, eventually, as a situation.

**1. Pension underfunding.** Contribute less than the actuarially required amount. Frees
operating cash immediately and — this is the trap — costs *no influence at all* the first
time. It is the cheapest thing on the menu today and the most expensive thing on it over
twenty years.

A pension is deferred compensation: a promise to pay a worker thirty years from now, which
you are supposed to fund today so investment returns can carry it. Each year an actuary
names a required contribution. Underpaying it is legal in most jurisdictions and was
routine — New Jersey skipped or shaved its contribution for roughly two decades.

Three properties make it the best lever in the design:

- **It compounds.** The gap grows at the assumed rate of return, around 7%. Skipping a
  payment does not cost the payment; it costs the payment plus compounding, forever. The
  amortization charge on past underfunding grows until the city is paying more for its
  past than for its present. Real cities reach the point where the pension line exceeds
  the police budget.
- **You cannot cut it.** Accrued benefits are constitutionally protected in many places —
  Illinois' pension clause is absolute, and its supreme court struck down the 2013 reform
  outright. The only available reform is a cheaper tier for *new* hires, which saves
  nothing for twenty years. **The fix the player is allowed to pass does nothing while
  they are in office.** That is a genuinely novel thing for a builder to model.
- **It was invisible until it wasn't.** Until GASB 67/68 landed in 2012–14, the net
  liability sat in the footnotes; the rule change dragged it onto the balance sheet and
  cities looked catastrophic overnight with nothing having actually changed.

**How much the player sees.** The same split as the influence meter, for the same reason.
The **contribution** is exact and unavoidable, sitting in the operating budget crowding out
services — that is the lived experience of a pension problem and it should be felt every
year. The **funded ratio** is a band, not a number: *Funded · Slipping · Strained ·
Critical*. The liability itself is an exact aggregate in the sim (situations need to
trigger off it) that surfaces at budget adoption and at rating reviews.

A future pass can go further and model the GASB moment itself — a disclosure reform that
reveals a number that was always there. Tempting, possibly too clever, noted and not
scheduled.

Worth naming for later: **OPEB**, retiree healthcare, is a second liability of the same
shape, almost never pre-funded, frequently larger than the pension hole, and far less
discussed. It is out of scope now and it is the obvious second course.

**2. Deferred maintenance.** Cut the maintenance line. Assets degrade, failure risk rises
(fire, water main breaks, road decay), and eventually the asset has to be *replaced* —
which is a capital expense, which means bonds, which means more debt service, which
squeezes the operating fund that got cut in the first place. The loop closes on itself,
which is exactly what makes it worth modelling.

**3. Revenue monetisation.** Sell a future revenue stream — parking, a utility concession
— for a lump sum today. A large capital injection now, a permanent operating revenue loss
forever, and a lasting influence penalty once the public works out what was done. The
Chicago parking meter deal as a playable object.

None of these should be labelled as mistakes in the UI. They are options, they work, and
the game trusts the player to understand what they are trading.

### Grants

External money with strings attached. A grant offer names a **purpose**, an **amount**, an
**expiry**, and a **local match** the city must put up from its own capital.

Grants are free money you are only allowed to spend on what somebody else wanted. That is
the whole mechanic: the bike bridge nobody asked for, built because it was ninety per cent
funded and the alternative was ninety per cent of nothing. A good grant offer should be
genuinely tempting *and* genuinely distorting, and the player should notice, three offers
in, that their city's shape is being decided somewhere else.

### Annual budget adoption

Once a game year the player adopts a budget: department allocations, the pension
contribution, the maintenance level. One screen, all the tradeoffs visible at once.

- Adopting a balanced operating budget on time grants influence.
- Adopting a deficit budget costs influence, scaled to the gap.
- Reopening the budget mid-year is possible and costs extra — reopening a budget is
  politically expensive, and that surcharge is what makes the annual decision weighty
  rather than a setting the player fiddles with continuously.

The annual cadence is a ritual, and rituals are how a systems game creates moments. It is
also the natural place to surface the liabilities: adoption is when the player sees the
pension line and decides, again, to look away.

## Part 3 — The incentive gradient

Everything above resolves into one deliberate asymmetry. Ranked by how easy each is for a
player to justify:

| Action | Visible? | Funded from | Influence |
| --- | --- | --- | --- |
| New construction | Yes — ribbon cutting | Capital (borrowed) | **Grants** it |
| Maintenance | No | Operating | Nothing |
| Pension contribution | No | Operating | Nothing — and *skipping* is free |

**The incentive gradient points directly at the bad decision.** Building new things with
borrowed money is visible, popular, and paid for by somebody who is not yet in the room.
Maintaining what exists is invisible and thankless. Funding a pension is invisible,
thankless, and optional.

The game is knowing when to walk up that gradient anyway.

For that to be a real choice and not a lesson, **the bad decision has to actually work.** A
player who defers maintenance and underfunds pensions for five years should have a
visibly better city than the player who did not: more parks, more transit, more happy
citizens, a stronger meter. The bill arrives in year eight, and by then it is genuinely
unclear whether the trade was wrong. Some of those bets pay off. A city that grew fast
enough can outrun its liabilities. That uncertainty is the point — a system where
discipline always wins is a lecture, not a game.

## Part 4 — Factions, elections, and sovereignty

Status within this document: **the least settled part.** The mechanics in Parts 1–3 are
specified; this part is a proposal with a strong spine and open joints, and it is marked
that way on purpose.

### Factions

Influence does not come from the public as an undifferentiated mass. It comes from
**factions**, each with a standing that rises and falls with what the player does. The
roster maps onto coalitions that are well documented and that already disagree with each
other:

| Faction | Wants | Historical anchor |
| --- | --- | --- |
| The growth machine | Development, upzoning, capital projects | Molotch's landowner–developer–newspaper bloc |
| Homeowners | Property values, low taxes, nothing new nearby | Prop 13 |
| Public-sector unions | Staffing, salaries, pension funding | Police and fire, whose claim is the most sympathetic and the most expensive |
| Business | Low fees, infrastructure, predictability | Chambers, BIDs |
| Residents of policed districts | Not being a revenue source | Ferguson |

Standings are the input to two things: **accrual rate** (a faction that likes you does you
favours) and **elections**.

The disagreement is the point. There is no configuration where everyone is happy, so
faction standing is not a score to maximise — it is a shape to choose. Upzoning delights
the growth machine and enrages homeowners. Funding the pension is invisible to everyone
except the union that will otherwise stop backing you.

### Political debt

The machine model, and the historically correct one: Tammany Hall, Daley's Chicago,
Pendergast's Kansas City, Curley's Boston. The machine gives you what you need now and
takes patronage forever.

When the meter is empty and the player needs to act anyway, they can **take a favour**. It
fills the meter immediately. In exchange the faction takes a **lien** on the city, and
periodically calls it in: enact this ordinance, kill that project, award us that contract,
staff that department. Complying is free. Refusing costs several times what the favour was
worth and turns the faction against you.

That is borrowing influence at interest, it completes the table in the thesis, and it
makes the empty end of the meter a *decision point* rather than a wall. A player at zero
influence is not stuck; they are being offered a bad deal, which is much more interesting.

Open: whether liens expire, whether they can be bought out with money, and how many can be
outstanding before the city is effectively governed by someone else. The last of those is
probably a soft cap enforced by the factions themselves — competing machines will not both
be paid.

### Elections

**An election never ends the game.** It sets the terms of the next term. Outcome is a
readout of faction standings, so it is not a judgment handed down — it is the score of a
game the player has been playing all along, which also means it is predictable enough to
plan around and never feels arbitrary.

| Result | Consequence |
| --- | --- |
| Strong mandate | The meter's cap lengthens for the term, and a **honeymoon window** of a few months where actions cost less |
| Narrow win | Nothing changes. The default |
| Loss | You stay. The council turns hostile: some levers lock, some policies are forced on you, accrual is throttled until standing is rebuilt |

Losing an election is therefore the same object as a control board — a sovereignty
penalty, not a game over. The city is untouched; the player's hands are tied.

Add one pacing rule with strong real-world grounding: **accrual sags late in a term.** A
lame duck gets fewer favours because nobody needs anything from them. This makes each term
an arc — spend early when you are strong, coast late — and gives the whole influence
economy a rhythm rather than a flat drip.

Open: term length in game years, whether the player can lose *twice* and what that means,
and whether an election is skippable for players who want the sandbox. That last one might
simply be a setup toggle, and probably should be.

### The sovereignty ladder

All the fail states in this design are one mechanic at different intensities. Each rung
leaves the city alone and takes away levers:

| Rung | Trigger | What is taken |
| --- | --- | --- |
| Credit downgrade | Thin reserves, deficit history, liability load | Borrowing gets expensive — the capital fund shrinks |
| Hostile council | Losing an election | Some levers lock; some policies are imposed |
| Faction lien | Taking favours | Specific decisions are made for you |
| State fine cap | Fine revenue past a share of the general fund | A revenue stream is capped and the excess clawed back |
| Oversight board | Sustained distress | Your budget assumptions stop being yours to choose — **and new revenue tools are handed to you in exchange** |
| Disincorporation | The far end of the fine-revenue path | The city stops being a city |

The historical ladder is real and worth naming for whoever tunes this: Pennsylvania's Act
47 (Pittsburgh sat in it for fourteen years), Michigan's emergency managers (Detroit; and
Flint, where an emergency manager's cost-cutting caused the water crisis — the darkest
available illustration that oversight is not automatically a rescue), New York City's 1975
control board, Washington DC's in 1995. Chapter 9 bankruptcy is rare and roughly half the
states do not authorise it, which is why it is the *least* useful model here. Outside the
US the same shape appears as the UK's **Section 114 notice** — Northamptonshire, Croydon,
Thurrock, Birmingham in 2023 — and Woking, which borrowed around £2bn at cheap public
rates to speculate on commercial property and detonated. That last one is precisely the
species of decision this design exists to make playable.

**Oversight must be survivable and exitable.** A rung the player can never climb back down
is a game over with extra steps. Every rung needs a stated path out, and climbing back
down should be one of the most satisfying things the game offers.

### Oversight, worked out

Pittsburgh spent fourteen years in Act 47 — designated in late December 2003, released on
12 February 2018 — and it is detailed enough to design directly from. Three things about
how it actually worked are better than what a designer would invent.

#### It takes your assumptions, not your decisions

This is the mechanic, and it is much sharper than "some buttons grey out."

Pittsburgh had two overseers at once: the Act 47 recovery coordinator, and a separate
**Intergovernmental Cooperation Authority** created by Act 11 of 2004. The ICA's statutory
remit is the thing worth stealing verbatim — it may consider only whether city budgets
*"are balanced, based upon prudent, reasonable and appropriate assumptions"* and whether
they comply with the recovery plan. **Policy is explicitly outside its jurisdiction.**

An oversight board is therefore aimed with precision at the adopt-versus-achieve gap in
Part 2. It does not tell the city what to build or whom to employ. It removes the city's
ability to balance a budget by being optimistic.

So mechanically: **under oversight, the revenue assumptions at budget adoption stop being
the player's to set.** They lock to conservative. Every gap has to be closed with a real
move rather than a hopeful projection, which retroactively disables the top of the gimmick
ladder and forces the player down to the rungs that hurt.

That is a far better constraint than confiscating levers. The player keeps complete agency
over what their city does, and loses only the ability to lie to themselves about whether
they can afford it. It also means the oversight rung is *legible*: the player knows exactly
what changed, because it is the one number they used to control and no longer do.

Alongside the audit comes a **recovery plan** — a small set of imposed targets (reserve
depth, headcount, funded ratio) that behave like a contract. Breaking it escalates.

#### It gives as well as takes

The part that turns a punishment into a decision. In exchange for oversight, the
legislature granted Pittsburgh taxing powers it could not otherwise have had:

- A **payroll preparation tax**, in exchange for immediately killing the mercantile tax and
  phasing out the business privilege tax.
- The occupational privilege tax raised from **$10 to $52** a year — now the local services
  tax. This is the commuter lever, and it is thematically perfect: it taxes people who use
  the city daily and cannot vote in it.
- A shifted share of the school district's earned income tax.
- And, with some irony given what happened in 2010, a *reduced* maximum parking tax rate.

So a rung of the ladder should hand something back. This makes the bottom of the ladder a
genuine strategic option rather than purely a thing to avoid: a player with a structural
deficit and no politically survivable tax lever might reasonably choose to trip into
oversight to unlock the tools. That is a much more interesting relationship with failure
than "do not touch."

It needs a counterweight or it becomes dominant. Three, all of them natural: the audit
binds for the entire duration, the exit is slow and cannot be rushed, and faction standing
— unions especially — craters on entry.

#### The exit is a long-horizon discipline, and that is the design problem

Pittsburgh did not cut its way out. Over the fourteen years revenue grew **62%** while
expenditures grew **44%**, and the gap compounding in its favour is the entire trick. It
entered with a $35M operating deficit on $349M of revenue; it left with a $10M surplus on
$566.4M.

Stated plainly: **fourteen game-years of "keep doing the boring thing" is dead air**, and
that is the real risk of this rung. The fix is to gate the exit on a handful of markers
that are individually visible and independently tracked, so a long grind reads as several
concurrent short arcs:

| Marker | Reads as |
| --- | --- |
| Reserve depth restored to target | Rungs of gimmick ladder rebuilt |
| Funded ratio out of the critical band | The pension stops eating the budget |
| Debt service below a share of operating revenue | The capital fund becomes usable again |
| N consecutive audited-balanced budgets | The assumption audit stops binding |

The player should always know which marker is lagging, and the last one to clear becomes
the story of that playthrough.

Two further details, both taken from what actually happened:

**Leaving is a sequence, not a switch.** Pittsburgh's two overseers left at different
times — Act 47 status ended in 2018 while the ICA outlasted it and its wind-down was a
separate fight of its own. The design should allow partial exits: the assumption audit can
lift while the recovery-plan targets still bind, or the reverse.

**The exit pays.** Pittsburgh kept the payroll preparation tax and the $52 local services
tax on the way out. The city emerged with a *better revenue base than it went in with*,
which is the reward that makes the grind worth playing: you do not merely return to
normal, you return to normal holding tools you could never have passed politically.

#### Entry should come late

One tuning note from the sequence of events. Pittsburgh laid off more than 400 employees
including 93 police officers and 20 EMTs, and closed every recreation centre and public
pool it had — **in the summer before it was designated distressed.** The state did not
arrive at the first bad year. It arrived after the city had visibly cut to the bone and it
still had not worked.

So the oversight trigger should fire well after the player is obviously suffering. A rung
that lands early reads as the game punishing a rough patch; a rung that lands after years
of visible decline reads as the consequence it is.

## Part 5 — The modifier bus

Policies, situations, and budget settings all need to say "while I am active, the world is
different." Letting each reach into systems directly would be a mess of cross-imports and
ordering hazards, so there is one narrow channel between them and the sim.

`state.modifiers` is a `Float64Array` of named channels, **recomputed from scratch every
tick** — reset to base, then accumulated over everything currently active. No incremental
bookkeeping, so there is no drift and no leak when something is repealed or resolves.
Systems read it and never write it.

Channels for the groundwork:

| Channel | Base | Read by |
| --- | --- | --- |
| `R_DEMAND_ADD` / `C_DEMAND_ADD` / `I_DEMAND_ADD` | 0 | `rci-demand.ts` |
| `TAX_REVENUE_MULT` | 1 | operating fund |
| `MAINTENANCE_MULT` | 1 | operating fund |
| `INFLUENCE_RATE_ADD` | 0 | influence accrual |
| `INFLUENCE_CAP_ADD` | 0 | influence accrual |

Every one is read **O(1)** — at the top of a system, or once per settlement. That is not an
accident: a channel consulted per tile costs a multiply across 65,536 tiles every tick
whether or not anything is modifying it. Per-tile channels (a land-value multiplier, a
fire-risk multiplier) are the obvious next additions and are cheap enough, but each should
arrive with a profile behind it, per the "measure, then fix" rule. The groundwork ships
none.

## Sim-side notes

Proposals, not decisions — but the constraints they respect are not optional.

- **Two treasuries, two aggregates, never summed anywhere in code.** A single "money"
  number, even as a convenience for the HUD, would silently undo the entire design. If a
  total is ever wanted for a chart, it gets computed at the display layer and named
  something that cannot be mistaken for a balance.
- **Liabilities are aggregates**: unfunded pension liability, deferred maintenance
  backlog, outstanding principal. They are state, not derived, and they belong in the
  shared buffer so the save gets them for free.
- **Influence stays an exact integer** in the sim regardless of how it is displayed.
  Hiding precision is a presentation decision; the model needs the precision for
  determinism and for exact-value tests.
- **Operating tails do not need a new grid pass.** Public finance already scans the grid
  weekly for maintenance; the per-building operating cost folds into that existing loop.
- **Budget adoption is a command**, on the existing tick calendar. Like a tax change it
  journals nothing and reports no change — it is government policy, not a map edit, so it
  must survive an undo and must not trigger a world rebake.
- **Determinism is unaffected.** Nothing here needs randomness except grant offers and
  situation triggers, both of which go through the existing seeded PRNG.

## Settled

Recorded so they are not reopened by accident.

- **The operating fund can go negative**, within a band, and there is no hard wall at
  zero. The real-world model is better than either extreme: balance is required at
  *adoption*, deficits during the year are normal, and the consequence is the gimmick
  ladder followed by a rating downgrade followed by oversight. Legibility comes from the
  ladder being visible, not from a wall.
- **Fees and fines are a distinct lever**, including the speed-trap path through to a
  state revenue cap and, at the far end, disincorporation.
- **Influence bands are medium-coarse** — five bands. Fine enough to inform a decision,
  coarse enough that watching one tick over teaches nothing.
- **Pension liability is shown as a band; the contribution is shown exactly.** The player
  feels it as crowding-out in the operating budget, which is how it actually presents.
- **Elections exist and are not a fail state.** They set the terms of the next term.
- **The meter has no hard floor in effect** — at empty, the player is offered faction
  favours rather than blocked. Political debt is the floor.
- **Oversight audits assumptions rather than confiscating levers**, hands back revenue
  tools in exchange, exits against a handful of independently visible markers, and lets
  the player keep the new tools on the way out. Worked out from Act 47 above.

## Open questions

- **Term length**, and whether elections can be switched off for sandbox players. The
  toggle is probably correct and cheap.
- **Do faction liens expire?** Permanent liens accumulate into paralysis; expiring ones
  make favours too cheap. Possibly they expire on a timer that resets each time the
  faction is refused.
- **How many liens before the city is effectively governed by someone else** — and is that
  a stated cap or an emergent one, with rival machines refusing to share a mayor?
- **Does the rating agency get a face?** A periodic review with a stated rationale is more
  legible than a number that moves, and it is a natural place to surface the liabilities.
- **How does enforcement intensity map to who pays it?** The speed-trap path needs the sim
  to know which districts absorb the fines, which is currently not tracked. This is the
  one settled feature with an unresolved data dependency.
- **The other rungs still need exits.** Oversight has one now. A faction lien, a hostile
  council, and a state fine cap do not, and the fine cap may correctly be permanent — a
  rule change you live with rather than escape, which is what actually happened in
  Missouri.
- **Can the player enter oversight deliberately?** The revenue tools make it tempting, and
  a design where failure is sometimes the right play is more interesting than one where it
  is not. But it needs to stay a desperate move rather than an opening strategy.
- **How long is fourteen years in game time?** Act 47 sets the emotional length of the
  grind, not the tick count. If a game year is short this is fine; if it is long the marker
  arcs have to carry more weight than they might bear.

## Explicitly out of scope

Named so the next person does not assume they were forgotten: no per-approach random
outcomes, no district-scoped budgets, no intergovernmental politics beyond flat transfers
and grants, no per-tile modifier channels, no save/load migration (persistence does not
exist yet), no advisor or notification feed, no labour negotiation as a distinct system
(pensions stand in for it).

## Divergence from the current branch

The implementation on `feat/influence-and-situations` was written against the previous
version of this design and does not match it. The gaps, so nobody has to rediscover them:

- Influence is implemented as a **secondary** resource alongside a single treasury, and
  the Governance dialog **prints it as a number** with a `/1000` cap. Both are now wrong.
- There is **one treasury**, not two funds. No wall, no operating tail, no capital
  restriction.
- **No liabilities exist** — no pensions, no maintenance backlog, no monetisation.
- **No grants and no budget adoption.**
- The influence cap is a fixed constant and the accrual rate has no upgrade path.
- Policies, the modifier bus, and the situation pool are broadly consistent with this
  document and are the parts most likely to survive.

Whether that code is reworked toward this doc or removed so the design can land clean is
an open call, not something this document decides.
