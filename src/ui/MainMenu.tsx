/**
 * MainMenu pages — the pre-game screens, one per route. The main menu offers
 * New City (Load City is a grayed-out stub until save/load exists); the
 * new-city page collects map size and seed and shows an accurate preview
 * rendered by the terrain-preview worker (the same `generateTerrain` the sim
 * uses, so what you see is what you get). Navigation is URL-driven (see
 * app/router.ts): Start City routes to `#/game?size=…&seed=…`, and the form
 * mirrors its state into the URL so a reload keeps it.
 */

import { useEffect, useRef, useState } from "react";
import {
	Button,
	Input,
	Label,
	TextField,
	ToggleButton,
	ToggleButtonGroup,
} from "react-aria-components";
import {
	createPreviewClient,
	type PreviewBitmap,
	type PreviewClient,
} from "../app/preview-client.ts";
import { navigate, parseSeedText, replaceRoute } from "../app/router.ts";

const MAP_SIZES = [
	{ id: "64", label: "Small", tiles: 64 },
	{ id: "128", label: "Medium", tiles: 128 },
	{ id: "256", label: "Large", tiles: 256 },
] as const;

const DEFAULT_SIZE_ID = "128";
const DEFAULT_SEED_TEXT = "42";

/** Upper bound (exclusive) for randomized seeds; matches the 9-digit rule. */
const SEED_LIMIT = 1_000_000_000;

/** Debounce so fast seed typing doesn't queue a generation per keystroke. */
const PREVIEW_DEBOUNCE_MS = 120;

export function MainMenuPage(): React.ReactElement {
	return (
		<MenuShell>
			<div className="menu-actions">
				<Button
					className="menu-btn primary"
					autoFocus
					onPress={() => navigate({ page: "new-city", size: null, seed: null })}
				>
					New City
				</Button>
				<Button className="menu-btn" isDisabled>
					Load City
				</Button>
				<p className="menu-hint">Loading saved cities is coming soon.</p>
			</div>
		</MenuShell>
	);
}

export function NewCityPage({
	initialSize,
	initialSeed,
}: {
	initialSize: number | null;
	initialSeed: number | null;
}): React.ReactElement {
	return (
		<MenuShell>
			<NewCityForm initialSize={initialSize} initialSeed={initialSeed} />
		</MenuShell>
	);
}

function MenuShell({
	children,
}: {
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div className="main-menu">
			<div className="menu-card">
				<h1 className="menu-title">landvalue-sim</h1>
				<p className="menu-subtitle">An economic city simulator</p>
				{children}
			</div>
		</div>
	);
}

function NewCityForm({
	initialSize,
	initialSeed,
}: {
	initialSize: number | null;
	initialSeed: number | null;
}): React.ReactElement {
	const [sizeId, setSizeId] = useState<string>(() =>
		initialSize !== null && MAP_SIZES.some((s) => s.tiles === initialSize)
			? String(initialSize)
			: DEFAULT_SIZE_ID,
	);
	const [seedText, setSeedText] = useState(() =>
		initialSeed !== null ? String(initialSeed) : DEFAULT_SEED_TEXT,
	);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const size = Number(sizeId);
	const seed = parseSeedText(seedText);
	const previewLoading = useTerrainPreview(canvasRef, size, seed);

	// Mirror valid form state into the URL (no history entry) so a reload
	// restores the same size/seed instead of resetting the form.
	useEffect(() => {
		if (seed === null) return;
		replaceRoute({ page: "new-city", size, seed });
	}, [size, seed]);

	return (
		<div className="new-city">
			<div className="menu-field">
				<span className="menu-label">Map size</span>
				<ToggleButtonGroup
					selectionMode="single"
					disallowEmptySelection
					className="size-group"
					selectedKeys={[sizeId]}
					onSelectionChange={(keys) => {
						const first = keys.values().next();
						if (!first.done) setSizeId(String(first.value));
					}}
				>
					{MAP_SIZES.map((s) => (
						<ToggleButton key={s.id} id={s.id} className="size-btn">
							<span className="size-btn-name">{s.label}</span>
							<span className="size-btn-tiles">
								{s.tiles}×{s.tiles}
							</span>
						</ToggleButton>
					))}
				</ToggleButtonGroup>
			</div>

			<div className="menu-field">
				<TextField
					className="seed-field"
					value={seedText}
					onChange={setSeedText}
					isInvalid={seed === null}
				>
					<Label className="menu-label">Seed</Label>
					<div className="seed-row">
						<Input className="seed-input" inputMode="numeric" />
						<Button
							className="seed-random-btn"
							onPress={() => setSeedText(String(randomSeed()))}
						>
							Randomize
						</Button>
					</div>
				</TextField>
				{seed === null ? (
					<p className="menu-error">Seed must be a number of 1–9 digits.</p>
				) : null}
			</div>

			<div className="menu-field">
				<span className="menu-label">Preview</span>
				<div className="preview-frame">
					<canvas
						ref={canvasRef}
						className="preview-canvas"
						aria-label="Generated landscape preview"
					/>
					{previewLoading ? (
						<div className="preview-loading">
							<div className="spinner" />
							<span>Generating…</span>
						</div>
					) : null}
				</div>
			</div>

			<div className="menu-footer">
				<Button className="menu-btn" onPress={() => navigate({ page: "menu" })}>
					Back
				</Button>
				<Button
					className="menu-btn primary"
					isDisabled={seed === null}
					onPress={() => {
						if (seed !== null) navigate({ page: "game", size, seed });
					}}
				>
					Start City
				</Button>
			</div>
		</div>
	);
}

/**
 * Drive the preview worker: on every size/seed change (debounced), request a
 * fresh terrain render and paint it into the canvas. Returns whether a render
 * is still pending. The worker is created on mount and torn down on unmount;
 * superseded requests resolve null and are ignored.
 */
function useTerrainPreview(
	canvasRef: React.RefObject<HTMLCanvasElement | null>,
	size: number,
	seed: number | null,
): boolean {
	const [loading, setLoading] = useState(true);
	const clientRef = useRef<PreviewClient | null>(null);

	useEffect(() => {
		const client = createPreviewClient();
		clientRef.current = client;
		return () => {
			clientRef.current = null;
			client.dispose();
		};
	}, []);

	useEffect(() => {
		if (seed === null) return;
		setLoading(true);
		const timer = window.setTimeout(() => {
			const client = clientRef.current;
			if (client === null) return;
			void client.request(size, seed).then((bitmap) => {
				if (bitmap === null) return; // superseded or disposed
				const canvas = canvasRef.current;
				if (canvas !== null) drawPreview(canvas, bitmap);
				setLoading(false);
			});
		}, PREVIEW_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [size, seed, canvasRef]);

	return loading;
}

function drawPreview(canvas: HTMLCanvasElement, bitmap: PreviewBitmap): void {
	const ctx = canvas.getContext("2d");
	console.assert(ctx !== null, "2D canvas context unavailable");
	if (ctx === null) return;
	canvas.width = bitmap.size;
	canvas.height = bitmap.size;
	ctx.putImageData(
		new ImageData(bitmap.pixels, bitmap.size, bitmap.size),
		0,
		0,
	);
}

/** UI-only randomness — the sim itself stays seeded and deterministic. */
function randomSeed(): number {
	const buf = new Uint32Array(1);
	crypto.getRandomValues(buf);
	return (buf[0] ?? 0) % SEED_LIMIT;
}
