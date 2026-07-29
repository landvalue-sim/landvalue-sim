import { describe, expect, it } from "vitest";
import { type CityState, createCity } from "./city-state.ts";
import type { Command } from "./commands.ts";
import {
	AGG,
	BUILDING_LOW,
	CORNER_ALL,
	COST_ROAD,
	DENSITY_LOW,
	ELEVATION_MAX,
	INFINITE_TREASURY,
	MAX_GRID_SIZE,
	MAX_TERRAFORM_DRAG_SIDE,
	ZONE_RESIDENTIAL,
} from "./constants.ts";
import { processCommands } from "./systems/command-processor.ts";
import { terraformTile } from "./terraform.ts";
import { applyEdits, refreshDerived, undoEdit } from "./tick.ts";
import {
	beginStep,
	clearJournal,
	commitStep,
	createUndoJournal,
	journalTile,
	journalVertex,
	TILE_CAPACITY,
	type UndoJournal,
	undoStep,
	VERTEX_CAPACITY,
} from "./undo.ts";

const W = 8;
const H = 8;

function makeCity(): CityState {
	return createCity({ width: W, height: H, seed: 1 });
}

/** One player edit: open a step, apply the batch, close it. */
function edit(
	journal: UndoJournal,
	city: CityState,
	commands: ReadonlyArray<Command>,
): boolean {
	beginStep(journal);
	void processCommands(city, commands, journal);
	return commitStep(journal);
}

describe("undo journal", () => {
	it("restores the tile and refunds what the edit cost", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const idx = 3 * W + 3;
		const before = city.aggregates[AGG.TREASURY] ?? 0;

		expect(edit(journal, city, [{ kind: "build-road", x: 3, y: 3 }])).toBe(
			true,
		);
		expect(city.roads[idx]).toBe(1);
		expect(city.aggregates[AGG.TREASURY]).toBe(before - COST_ROAD);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[idx]).toBe(0);
		expect(city.aggregates[AGG.TREASURY]).toBe(before);
	});

	it("unwinds edits one at a time, newest first", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		edit(journal, city, [{ kind: "build-road", x: 1, y: 1 }]);
		edit(journal, city, [{ kind: "build-road", x: 2, y: 1 }]);
		edit(journal, city, [{ kind: "build-road", x: 3, y: 1 }]);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[1 * W + 3]).toBe(0);
		expect(city.roads[1 * W + 2]).toBe(1);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[1 * W + 2]).toBe(0);
		expect(city.roads[1 * W + 1]).toBe(1);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[1 * W + 1]).toBe(0);
		expect(undoStep(journal, city)).toBe(false);
	});

	it("undoes a whole drag as the one gesture it was", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const cmds: Command[] = [];
		for (let x = 0; x < 5; x++) cmds.push({ kind: "build-road", x, y: 4 });

		expect(edit(journal, city, cmds)).toBe(true);
		expect(undoStep(journal, city)).toBe(true);
		for (let x = 0; x < 5; x++) expect(city.roads[4 * W + x]).toBe(0);
		expect(undoStep(journal, city)).toBe(false);
	});

	it("reports an empty journal rather than restoring garbage", () => {
		const city = makeCity();
		expect(undoStep(createUndoJournal(), city)).toBe(false);
	});

	it("does not spend a step on an edit that changed nothing", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		expect(edit(journal, city, [{ kind: "build-road", x: 4, y: 4 }])).toBe(
			true,
		);
		// Already a road: nothing to record, so no step.
		expect(edit(journal, city, [{ kind: "build-road", x: 4, y: 4 }])).toBe(
			false,
		);
		expect(journal.count).toBe(1);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[4 * W + 4]).toBe(0);
	});

	it("does not spend a step on a tax-rate change", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		expect(
			edit(journal, city, [{ kind: "set-tax-rate", sector: "r", rate: 0.15 }]),
		).toBe(false);
		expect(journal.count).toBe(0);
		expect(city.aggregates[AGG.TAX_RATE_R]).toBe(0.15);
	});

	it("leaves the clock, the demand curves, and the tax rates alone", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		edit(journal, city, [{ kind: "build-road", x: 2, y: 2 }]);
		city.aggregates[AGG.TICK] = 500;
		city.aggregates[AGG.R_DEMAND] = 123;
		city.aggregates[AGG.TAX_RATE_R] = 0.11;

		expect(undoStep(journal, city)).toBe(true);
		expect(city.aggregates[AGG.TICK]).toBe(500);
		expect(city.aggregates[AGG.R_DEMAND]).toBe(123);
		expect(city.aggregates[AGG.TAX_RATE_R]).toBe(0.11);
	});

	// The point of journalling deltas instead of snapshotting the map: whatever
	// the simulation did between the edit and the undo has to survive it.
	it("keeps what the simulation changed elsewhere after the edit", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const far = 7 * W + 7;

		edit(journal, city, [{ kind: "build-road", x: 1, y: 1 }]);

		// Stand in for a tick's worth of growth on an untouched tile.
		city.zoning[far] = ZONE_RESIDENTIAL;
		city.building[far] = BUILDING_LOW;
		city.population[far] = 40;
		const treasuryAfterTaxes = (city.aggregates[AGG.TREASURY] ?? 0) + 900;
		city.aggregates[AGG.TREASURY] = treasuryAfterTaxes;

		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[1 * W + 1]).toBe(0);
		// The far tile and the tax take are untouched; only the road is refunded.
		expect(city.zoning[far]).toBe(ZONE_RESIDENTIAL);
		expect(city.building[far]).toBe(BUILDING_LOW);
		expect(city.population[far]).toBe(40);
		expect(city.aggregates[AGG.TREASURY]).toBe(treasuryAfterTaxes + COST_ROAD);
	});

	it("puts back a building the edit bulldozed", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const idx = 5 * W + 5;

		city.zoning[idx] = ZONE_RESIDENTIAL;
		city.densityCap[idx] = DENSITY_LOW;
		city.building[idx] = BUILDING_LOW;
		city.population[idx] = 40;

		expect(edit(journal, city, [{ kind: "demolish", x: 5, y: 5 }])).toBe(true);
		expect(city.building[idx]).toBe(0);
		expect(city.population[idx]).toBe(0);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.zoning[idx]).toBe(ZONE_RESIDENTIAL);
		expect(city.densityCap[idx]).toBe(DENSITY_LOW);
		expect(city.building[idx]).toBe(BUILDING_LOW);
		expect(city.population[idx]).toBe(40);
	});

	it("restores every vertex a terraform edit sloped, not just the tile", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const vw = W + 1;
		for (let i = 0; i < city.vertexHeights.length; i++) {
			city.vertexHeights[i] = 5;
		}
		city.elevation.fill(5); // keep the derived layer consistent with the corners

		// A level to 0 from a plateau of 5 ripples five vertices outward.
		expect(
			edit(journal, city, [{ kind: "level-terrain", x: 4, y: 4, level: 0 }]),
		).toBe(true);
		expect(city.vertexHeights[4 * vw + 4]).toBe(0);
		expect(city.elevation[4 * W + 4]).toBe(0);

		expect(undoStep(journal, city)).toBe(true);
		for (let i = 0; i < city.vertexHeights.length; i++) {
			expect(city.vertexHeights[i]).toBe(5);
		}
		expect(city.elevation[4 * W + 4]).toBe(5);
	});

	it("restores terrain a terraform edit reclaimed from water", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		expect(
			edit(journal, city, [{ kind: "set-water", x: 5, y: 5, place: true }]),
		).toBe(true);
		const waterIdx = 5 * W + 5;
		const flooded = city.terrain[waterIdx];

		// Raising the bed above the surface turns the tile back into land.
		expect(
			edit(journal, city, [
				{ kind: "terraform", x: 5, y: 5, corner: CORNER_ALL, dir: 1 },
			]),
		).toBe(true);
		expect(city.terrain[waterIdx]).not.toBe(flooded);

		expect(undoStep(journal, city)).toBe(true);
		expect(city.terrain[waterIdx]).toBe(flooded);
	});

	it("keeps only the newest steps once the ring wraps", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const total = 40; // more than MAX_UNDO_STEPS

		for (let i = 0; i < total; i++) {
			const x = i % W;
			const y = Math.floor(i / W);
			edit(journal, city, [
				{
					kind: "zone",
					x,
					y,
					zoneType: ZONE_RESIDENTIAL,
					density: DENSITY_LOW,
				},
			]);
		}
		const depth = journal.count;
		expect(depth).toBeLessThan(total);

		for (let i = 0; i < depth; i++) expect(undoStep(journal, city)).toBe(true);
		expect(undoStep(journal, city)).toBe(false);

		// The oldest edits fell off the end and stay applied.
		expect(city.zoning[0]).toBe(ZONE_RESIDENTIAL);
		expect(city.zoning[total - depth]).toBe(0);
	});

	// A capture that is staged and then abandoned must not eat a committed step,
	// which is what a fixed slot-per-edit ring gets wrong once it is full.
	it("survives no-op edits interleaved with a full history", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		for (let i = 0; i < 40; i++) {
			const x = i % W;
			const y = Math.floor(i / W);
			edit(journal, city, [
				{
					kind: "zone",
					x,
					y,
					zoneType: ZONE_RESIDENTIAL,
					density: DENSITY_LOW,
				},
			]);
			// A batch that changes nothing, right on top of a full history.
			expect(edit(journal, city, [{ kind: "demolish", x: 7, y: 7 }])).toBe(
				false,
			);
		}

		const depth = journal.count;
		for (let i = 0; i < depth; i++) expect(undoStep(journal, city)).toBe(true);
		expect(undoStep(journal, city)).toBe(false);

		// Every step that was still in the history undid one zoning, and no undo
		// ever put one back.
		let zoned = 0;
		for (let i = 0; i < city.size; i++) {
			if ((city.zoning[i] ?? 0) === ZONE_RESIDENTIAL) zoned++;
		}
		expect(zoned).toBe(40 - depth);
	});

	// Eviction judges a step by where the arenas stood when it began, not by
	// whether it holds records in the lapped arena. A tiles-only step sitting
	// in front of a lapped vertex step must not stop eviction early: that would
	// leave the lapped step reachable, and undoing it would replay arena slots
	// that newer writes now own.
	it("evicts a lapped step buried behind steps that skipped that arena", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		// Oldest step: tile records only, no vertex records.
		city.roads[0] = 1;
		beginStep(journal);
		journalTile(journal, city, 0);
		expect(commitStep(journal)).toBe(true);

		// Next step: a single vertex record — vertex 0 moving from 5 to 6.
		city.vertexHeights[0] = 5;
		beginStep(journal);
		journalVertex(journal, city, 0);
		city.vertexHeights[0] = 6;
		expect(commitStep(journal)).toBe(true);

		// Two steps that together lap the vertex arena, overwriting that record.
		for (let s = 0; s < 2; s++) {
			beginStep(journal);
			for (let i = 0; i < VERTEX_CAPACITY / 2 + 1; i++) {
				journalVertex(journal, city, 1);
			}
			expect(commitStep(journal)).toBe(true);
		}

		// Everything the lapping overwrote is gone — including the tiles-only
		// step, which predates the lapped one.
		expect(journal.count).toBe(1);

		// The survivor unwinds cleanly; the evicted steps stay applied.
		expect(undoStep(journal, city)).toBe(true);
		expect(undoStep(journal, city)).toBe(false);
		expect(city.vertexHeights[0]).toBe(6);
		expect(city.roads[0]).toBe(1);
	});

	// A step that outgrows a whole arena overwrites its own earliest records, so
	// nothing could replay it later. Rather than keep a half-recorded step that
	// would undo into garbage, the commit throws the history away and reports
	// that it kept nothing.
	it("drops the history when one edit outgrows an arena", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		// A normal step first, so there is history to lose.
		expect(edit(journal, city, [{ kind: "build-road", x: 1, y: 1 }])).toBe(
			true,
		);
		expect(journal.count).toBe(1);

		// One step writing more tile records than the tile arena can hold.
		beginStep(journal);
		for (let i = 0; i < TILE_CAPACITY + 1; i++) {
			journalTile(journal, city, 0);
		}
		expect(journal.overflowed).toBe(true);
		expect(commitStep(journal)).toBe(false);

		// Nothing is undoable, and the city keeps everything both steps did —
		// dropping the record of an edit never rolls the edit back.
		expect(journal.count).toBe(0);
		expect(undoStep(journal, city)).toBe(false);
		expect(city.roads[1 * W + 1]).toBe(1);

		// The journal is still usable: the next edit records and unwinds normally.
		expect(edit(journal, city, [{ kind: "build-road", x: 2, y: 2 }])).toBe(
			true,
		);
		expect(journal.count).toBe(1);
		expect(undoStep(journal, city)).toBe(true);
		expect(city.roads[2 * W + 2]).toBe(0);
	});

	// The same rule on the other arena, which terraform drags fill instead.
	it("drops the history when one terraform edit outgrows the vertex arena", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		expect(edit(journal, city, [{ kind: "build-road", x: 3, y: 3 }])).toBe(
			true,
		);

		beginStep(journal);
		for (let i = 0; i < VERTEX_CAPACITY + 1; i++) {
			journalVertex(journal, city, 0);
		}
		expect(journal.overflowed).toBe(true);
		expect(commitStep(journal)).toBe(false);

		expect(journal.count).toBe(0);
		expect(undoStep(journal, city)).toBe(false);
		expect(city.roads[3 * W + 3]).toBe(1);
	});

	it("drops its history when the city underneath is replaced", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		edit(journal, city, [{ kind: "build-road", x: 5, y: 5 }]);
		clearJournal(journal);

		expect(undoStep(journal, city)).toBe(false);
		expect(city.roads[5 * W + 5]).toBe(1);
	});

	it("records nothing when no journal is passed", () => {
		const city = makeCity();
		// The tick path applies commands with no journal at all.
		expect(processCommands(city, [{ kind: "build-road", x: 1, y: 1 }])).toBe(1);
		expect(terraformTile(city, 3, 3, CORNER_ALL, 1)).toBe(true);
		expect(city.roads[1 * W + 1]).toBe(1);
	});
});

describe("undoEdit", () => {
	it("rebuilds derived layers and moves the revision forward", () => {
		const city = makeCity();
		const journal = createUndoJournal();

		void applyEdits(city, [{ kind: "build-road", x: 2, y: 2 }], journal);
		const revisionAfterEdit = city.aggregates[AGG.REVISION] ?? 0;

		expect(undoEdit(city, journal)).toBe(true);
		expect(city.roads[2 * W + 2]).toBe(0);
		expect(city.aggregates[AGG.REVISION] ?? 0).toBeGreaterThan(
			revisionAfterEdit,
		);

		expect(undoEdit(city, journal)).toBe(false);
	});

	it("keeps the population readout honest while paused", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const idx = 5 * W + 5;

		city.zoning[idx] = ZONE_RESIDENTIAL;
		city.densityCap[idx] = DENSITY_LOW;
		city.building[idx] = BUILDING_LOW;

		refreshDerived(city); // stand in for the tick that grew the building
		const pop = city.aggregates[AGG.TOTAL_POP] ?? 0;
		expect(pop).toBeGreaterThan(0);

		void applyEdits(city, [{ kind: "demolish", x: 5, y: 5 }], journal);
		expect(city.aggregates[AGG.TOTAL_POP]).toBe(0);

		expect(undoEdit(city, journal)).toBe(true);
		expect(city.aggregates[AGG.TOTAL_POP]).toBe(pop);
	});

	it("is a no-op on a level that is already flat", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const level = Math.min(3, ELEVATION_MAX);
		for (let i = 0; i < city.vertexHeights.length; i++) {
			city.vertexHeights[i] = level;
		}

		expect(
			applyEdits(city, [{ kind: "level-terrain", x: 2, y: 2, level }], journal),
		).toBe(0);
		expect(journal.count).toBe(0);
	});
});

/**
 * The per-tile layers a record carries, in `captureTile`'s write order.
 *
 * `captureTile`, `restoreTile` and `TILE_U8_COUNT` are three hand-maintained
 * things that have to agree, and nothing in the types ties them together. The
 * round-trip below drives this one list through both halves, so a layer added
 * to one function and not the other, a stale `TILE_U8_COUNT`, or an ordering
 * mismatch between the two all surface as a wrong value rather than as undo
 * quietly restoring garbage.
 */
const RECORDED_U8 = [
	"terrain",
	"zoning",
	"building",
	"roads",
	"rail",
	"powerLines",
	"civic",
	"waterPipes",
	"densityCap",
	"waterLevel",
	"elevation",
] as const;

/**
 * Every other u8 layer. These are pure functions of the grid that
 * `refreshDerived` rebuilds after an undo, so recording them would reinstate a
 * reading the simulation had already moved past. Spelled out rather than
 * inferred so that adding a layer to `CityState` fails this file until someone
 * has decided which of the two lists it belongs on.
 */
const DERIVED_U8 = [
	"pollution",
	"traffic",
	"power",
	"waterCoverage",
	"crime",
	"policeCoverage",
	"fireCoverage",
	"fire",
	"educationCoverage",
	"healthCoverage",
] as const;

describe("undo tile record format", () => {
	it("round-trips every recorded layer of every journaled tile", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const idxA = 2 * W + 2;
		const idxB = 2 * W + 3;

		// Distinct per layer so an ordering mismatch shows, and distinct per tile
		// so a wrong TILE_U8_COUNT — which shears every record after the first —
		// shows too.
		for (let i = 0; i < RECORDED_U8.length; i++) {
			const layer = RECORDED_U8[i] ?? "terrain";
			city[layer][idxA] = i + 1;
			city[layer][idxB] = i + 101;
		}
		city.population[idxA] = 1234;
		city.jobs[idxA] = 4321;
		city.population[idxB] = 5678;
		city.jobs[idxB] = 8765;

		beginStep(journal);
		journalTile(journal, city, idxA);
		journalTile(journal, city, idxB);
		expect(commitStep(journal)).toBe(true);

		for (const layer of RECORDED_U8) {
			city[layer][idxA] = 255;
			city[layer][idxB] = 254;
		}
		city.population[idxA] = 0;
		city.jobs[idxA] = 0;
		city.population[idxB] = 0;
		city.jobs[idxB] = 0;

		expect(undoStep(journal, city)).toBe(true);

		for (let i = 0; i < RECORDED_U8.length; i++) {
			const layer = RECORDED_U8[i] ?? "terrain";
			expect(city[layer][idxA], layer).toBe(i + 1);
			expect(city[layer][idxB], layer).toBe(i + 101);
		}
		expect(city.population[idxA]).toBe(1234);
		expect(city.jobs[idxA]).toBe(4321);
		expect(city.population[idxB]).toBe(5678);
		expect(city.jobs[idxB]).toBe(8765);
	});

	it("leaves derived layers to refreshDerived rather than restoring them", () => {
		const city = makeCity();
		const journal = createUndoJournal();
		const idx = 4 * W + 4;

		beginStep(journal);
		journalTile(journal, city, idx);
		expect(commitStep(journal)).toBe(true);

		// A tick's worth of derived readings, written after the record was taken.
		for (const layer of DERIVED_U8) city[layer][idx] = 77;

		expect(undoStep(journal, city)).toBe(true);
		for (const layer of DERIVED_U8) expect(city[layer][idx], layer).toBe(77);
	});

	it("accounts for every per-tile u8 layer on CityState", () => {
		const city = makeCity();
		const classified = new Set<string>([...RECORDED_U8, ...DERIVED_U8]);

		const perTile: string[] = [];
		for (const [name, value] of Object.entries(city)) {
			// vertexHeights is the corner grid, not a tile layer — it is a
			// different length and gets its own record type.
			if (value instanceof Uint8Array && value.length === city.size) {
				perTile.push(name);
			}
		}

		expect(perTile.length).toBeGreaterThan(0);
		for (const name of perTile) {
			expect(
				classified.has(name),
				`${name} is neither recorded nor derived`,
			).toBe(true);
		}
		expect(perTile.length).toBe(classified.size);
	});
});

/**
 * The terraform drag cap exists to keep one gesture inside the undo arenas.
 * That is a relationship between two constants in different modules with a
 * terrain-dependent ripple in between, so it is measured rather than argued:
 * raise MAX_TERRAFORM_DRAG_SIDE, or shrink an arena, and this fails.
 */
describe("terraform drag cap", () => {
	it("keeps its undo step at the worst case the cap allows", () => {
		const city = createCity({
			width: MAX_GRID_SIZE,
			height: MAX_GRID_SIZE,
			seed: 1,
		});
		// The most expensive ground there is: flat at sea level, so every tile in
		// the drag ripples the full ELEVATION_MAX rings to reach the target.
		city.vertexHeights.fill(0);
		city.aggregates[AGG.DEBUG_INFINITE_MONEY] = 1;
		city.aggregates[AGG.TREASURY] = INFINITE_TREASURY;

		// Centred, so no map edge clips the ripple and shortens the record count.
		const side = MAX_TERRAFORM_DRAG_SIDE;
		const off = Math.floor((MAX_GRID_SIZE - side) / 2);
		const cmds: Command[] = [];
		for (let y = off; y < off + side; y++) {
			for (let x = off; x < off + side; x++) {
				cmds.push({ kind: "level-terrain", x, y, level: ELEVATION_MAX });
			}
		}

		const journal = createUndoJournal();
		expect(applyEdits(city, cmds, journal)).toBe(side * side);

		// The point of the cap: the largest terraform gesture the player can make
		// is still undoable. Before it, this drag lapped both arenas and took the
		// whole history with it.
		expect(journal.overflowed).toBe(false);
		expect(journal.count).toBe(1);
		expect(journal.vertWritten).toBeLessThan(VERTEX_CAPACITY);
		expect(journal.tileWritten).toBeLessThan(TILE_CAPACITY);

		expect(undoEdit(city, journal)).toBe(true);
		expect(journal.count).toBe(0);
		for (let i = 0; i < city.vertexHeights.length; i++) {
			expect(city.vertexHeights[i]).toBe(0);
		}
	});
});
