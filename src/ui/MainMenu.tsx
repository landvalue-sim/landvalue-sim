/**
 * MainMenu — the pre-game menu layer. New City collects map size and seed and
 * shows an accurate preview rendered by the terrain-preview worker (the same
 * `generateTerrain` the sim uses, so what you see is what you get). Load City
 * is a grayed-out stub until save/load exists. `onStart` hands the chosen
 * config to the root, which builds the real sim client.
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

export interface NewCityConfig {
	width: number;
	height: number;
	seed: number;
}

const MAP_SIZES = [
	{ id: "64", label: "Small", tiles: 64 },
	{ id: "128", label: "Medium", tiles: 128 },
	{ id: "256", label: "Large", tiles: 256 },
] as const;

/** Seeds are non-negative decimal integers; 9 digits keeps them in 32 bits. */
const SEED_PATTERN = /^\d{1,9}$/;
const SEED_LIMIT = 1_000_000_000;

/** Debounce so fast seed typing doesn't queue a generation per keystroke. */
const PREVIEW_DEBOUNCE_MS = 120;

export function MainMenu({
	onStart,
}: {
	onStart: (config: NewCityConfig) => void;
}): React.ReactElement {
	const [screen, setScreen] = useState<"root" | "new-city">("root");

	return (
		<div className="main-menu">
			<div className="menu-card">
				<h1 className="menu-title">landvalue-sim</h1>
				<p className="menu-subtitle">An economic city simulator</p>
				{screen === "root" ? (
					<RootScreen onNewCity={() => setScreen("new-city")} />
				) : (
					<NewCityScreen onBack={() => setScreen("root")} onStart={onStart} />
				)}
			</div>
		</div>
	);
}

function RootScreen({
	onNewCity,
}: {
	onNewCity: () => void;
}): React.ReactElement {
	return (
		<div className="menu-actions">
			<Button className="menu-btn primary" onPress={onNewCity} autoFocus>
				New City
			</Button>
			<Button className="menu-btn" isDisabled>
				Load City
			</Button>
			<p className="menu-hint">Loading saved cities is coming soon.</p>
		</div>
	);
}

function NewCityScreen({
	onBack,
	onStart,
}: {
	onBack: () => void;
	onStart: (config: NewCityConfig) => void;
}): React.ReactElement {
	const [sizeId, setSizeId] = useState<string>("128");
	const [seedText, setSeedText] = useState("42");
	const [starting, setStarting] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const size = Number(sizeId);
	const seed = parseSeed(seedText);
	const previewLoading = useTerrainPreview(canvasRef, size, seed);

	// Defer the actual start one frame so the busy overlay paints before the
	// synchronous city build (SAB alloc + terrain gen) blocks the main thread.
	useEffect(() => {
		if (!starting || seed === null) return;
		let timer = 0;
		const raf = requestAnimationFrame(() => {
			timer = window.setTimeout(
				() => onStart({ width: size, height: size, seed }),
				0,
			);
		});
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(timer);
		};
	}, [starting, size, seed, onStart]);

	return (
		<div className="new-city">
			<div className="menu-field">
				<span className="menu-label">Map size</span>
				<ToggleButtonGroup
					selectionMode="single"
					disallowEmptySelection
					className="size-group"
					selectedKeys={[sizeId]}
					isDisabled={starting}
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
					isDisabled={starting}
				>
					<Label className="menu-label">Seed</Label>
					<div className="seed-row">
						<Input className="seed-input" inputMode="numeric" />
						<Button
							className="seed-random-btn"
							isDisabled={starting}
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
				<Button className="menu-btn" onPress={onBack} isDisabled={starting}>
					Back
				</Button>
				<Button
					className="menu-btn primary"
					isDisabled={seed === null || starting}
					onPress={() => setStarting(true)}
				>
					Start City
				</Button>
			</div>

			{starting ? (
				<div className="menu-busy">
					<div className="spinner" />
					<span>Founding city…</span>
				</div>
			) : null}
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

function parseSeed(text: string): number | null {
	const trimmed = text.trim();
	if (!SEED_PATTERN.test(trimmed)) return null;
	return Number(trimmed);
}

/** UI-only randomness — the sim itself stays seeded and deterministic. */
function randomSeed(): number {
	const buf = new Uint32Array(1);
	crypto.getRandomValues(buf);
	return (buf[0] ?? 0) % SEED_LIMIT;
}
