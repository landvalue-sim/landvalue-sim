/**
 * Generate all isometric building sprites for the landvalue-sim renderer.
 *
 * Uses the game's 2:1 isometric projection (HALF_W=16, HALF_H=8).
 * Solo (1x1) sprites are 64xH at 2x resolution.
 * Cluster sprites scale proportionally (2x2 = 128xH, 3x3 = 192xH).
 *
 * Isometric orientation:
 *   (x0,y0) = south/front corner (bottom of screen)
 *   (x1,y0) = east/right corner
 *   (x0,y1) = west/left corner
 *   (x1,y1) = north/back corner (top of screen)
 *
 * Visible faces: left wall (tx=x0), right wall (ty=y0), roof.
 * Hidden faces: back-left (ty=y1), back-right (tx=x1) — occluded by
 * front walls + roof, so we never draw them.
 *
 * Usage: node tools/gen-sprites.cjs
 */
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

// ---- Drawing engine ---------------------------------------------------------

function createCanvas(w, h) {
	return { w, h, px: Buffer.alloc(w * h * 4, 0) };
}

function set(c, x, y, r, g, b, a) {
	x = x | 0;
	y = y | 0;
	if (x >= 0 && x < c.w && y >= 0 && y < c.h) {
		const i = (y * c.w + x) * 4;
		if (a === undefined) a = 255;
		if (a < 255 && c.px[i + 3] > 0) {
			const srcA = a / 255;
			const dstA = c.px[i + 3] / 255;
			const outA = srcA + dstA * (1 - srcA);
			c.px[i] = ((r * srcA + c.px[i] * dstA * (1 - srcA)) / outA) | 0;
			c.px[i + 1] = ((g * srcA + c.px[i + 1] * dstA * (1 - srcA)) / outA) | 0;
			c.px[i + 2] = ((b * srcA + c.px[i + 2] * dstA * (1 - srcA)) / outA) | 0;
			c.px[i + 3] = (outA * 255) | 0;
		} else {
			c.px[i] = r;
			c.px[i + 1] = g;
			c.px[i + 2] = b;
			c.px[i + 3] = a;
		}
	}
}

function fillPoly(c, pts, r, g, b, a) {
	if (a === undefined) a = 255;
	let yMin = c.h;
	let yMax = 0;
	for (const p of pts) {
		if (p[1] < yMin) yMin = p[1];
		if (p[1] > yMax) yMax = p[1];
	}
	yMin = Math.max(0, Math.floor(yMin));
	yMax = Math.min(c.h - 1, Math.ceil(yMax));
	for (let y = yMin; y <= yMax; y++) {
		const xs = [];
		for (let i = 0; i < pts.length; i++) {
			const [x1, y1] = pts[i];
			const [x2, y2] = pts[(i + 1) % pts.length];
			if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
				xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
			}
		}
		xs.sort((a, b) => a - b);
		for (let i = 0; i + 1 < xs.length; i += 2) {
			for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) {
				set(c, x, y, r, g, b, a);
			}
		}
	}
}

function drawLine(c, x0, y0, x1, y1, r, g, b, a) {
	if (a === undefined) a = 255;
	x0 = Math.round(x0);
	y0 = Math.round(y0);
	x1 = Math.round(x1);
	y1 = Math.round(y1);
	const dx = Math.abs(x1 - x0);
	const dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx - dy;
	for (let steps = 0; steps < 2000; steps++) {
		set(c, x0, y0, r, g, b, a);
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * err;
		if (e2 > -dy) {
			err -= dy;
			x0 += sx;
		}
		if (e2 < dx) {
			err += dx;
			y0 += sy;
		}
	}
}

// ---- Isometric helpers ------------------------------------------------------

function makeIso(canvasW, canvasH, tileW, tileH) {
	const halfW = canvasW / 2;
	const pxPerTileX = canvasW / (tileW + tileH);
	const pxPerTileY = pxPerTileX / 2;
	return function iso(tx, ty, tz) {
		const sx = halfW + (tx - ty) * pxPerTileX;
		const sy = canvasH - 1 - (tx + ty) * pxPerTileY - (tz || 0);
		return [sx, sy];
	};
}

function quad(iso, p1, p2, p3, p4) {
	return [iso(...p1), iso(...p2), iso(...p3), iso(...p4)];
}

// ---- Outline helpers --------------------------------------------------------

/**
 * Draw the visible outlines of a flat-roofed iso box.
 * Visible edges: 3 vertical columns (W, S, E), 2 base diagonals (W-S, S-E),
 * 2 front eaves (S-W, S-E at roof), 2 roof back edges (W-N, E-N at roof).
 * Hidden: back vertical (N column), back base (W-N, E-N at ground).
 */
function drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL) {
	// Visible vertical columns
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL); // W column
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL); // S column (front)
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL); // E column
	// Visible base diagonals
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL); // W-S base
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL); // S-E base
	// Roof diamond (all 4 edges visible from above)
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL); // S-W eave
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL); // S-E eave
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL); // W-N roof edge
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL); // E-N roof edge
}

/**
 * Draw the two visible wall fills + flat roof of an iso box.
 * Only draws front-facing walls (tx=x0 left, ty=y0 right) and the roof.
 */
function drawFlatBox(c, iso, x0, y0, x1, y1, wh, p) {
	// Roof (draw first so walls overlay at edges for crisp seams)
	fillPoly(
		c,
		quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]),
		...p.roofDark,
	);
	// Left wall (tx=x0, west face — darker)
	fillPoly(
		c,
		quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]),
		...p.wallDark,
	);
	// Right wall (ty=y0, south face — lighter)
	fillPoly(
		c,
		quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]),
		...p.wallLight,
	);
}

// ---- Minimal PNG encoder ----------------------------------------------------

function crc32(buf) {
	let c2 = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c2 ^= buf[i];
		for (let j = 0; j < 8; j++) c2 = (c2 >>> 1) ^ (c2 & 1 ? 0xedb88320 : 0);
	}
	return (c2 ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const t = Buffer.from(type);
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
	return Buffer.concat([len, t, data, crc]);
}

function writePng(canvas, filePath) {
	const { w, h, px } = canvas;
	const raw = Buffer.alloc(h * (1 + w * 4));
	for (let y = 0; y < h; y++) {
		raw[y * (1 + w * 4)] = 0;
		px.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6; // RGBA
	const out = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", zlib.deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, out);
	console.log(`  ${path.basename(filePath)} (${w}x${h}, ${out.length} bytes)`);
}

// ---- Color palettes ---------------------------------------------------------

const PALETTES = {
	r: {
		wallLight: [220, 198, 160],
		wallDark: [195, 175, 140],
		roofLight: [195, 85, 62],
		roofDark: [175, 70, 50],
		gable: [228, 208, 172],
		outline: [55, 40, 30],
		window: [145, 200, 235],
		door: [115, 75, 45],
		accent: [180, 60, 40],
	},
	c: {
		wallLight: [160, 185, 210],
		wallDark: [130, 155, 185],
		roofLight: [100, 120, 150],
		roofDark: [80, 100, 130],
		gable: [140, 165, 195],
		outline: [40, 50, 65],
		window: [170, 210, 245],
		door: [80, 95, 115],
		accent: [55, 120, 200],
	},
	i: {
		wallLight: [190, 180, 160],
		wallDark: [165, 155, 135],
		roofLight: [140, 135, 120],
		roofDark: [120, 115, 100],
		gable: [175, 168, 148],
		outline: [60, 55, 45],
		window: [120, 130, 130],
		door: [100, 90, 70],
		accent: [180, 110, 50],
	},
};

// ---- Building generators ----------------------------------------------------

/** R1: Small house with pitched roof, door, windows, yard. */
function drawR1(c, iso) {
	const p = PALETTES.r;
	const OL = p.outline;

	// Grass yard
	fillPoly(c, [iso(0, 0), iso(1, 0), iso(1, 1), iso(0, 1)], 76, 175, 80);
	drawLine(c, ...iso(0, 0), ...iso(1, 0), 56, 142, 60);
	drawLine(c, ...iso(1, 0), ...iso(1, 1), 56, 142, 60);
	drawLine(c, ...iso(1, 1), ...iso(0, 1), 56, 142, 60);
	drawLine(c, ...iso(0, 1), ...iso(0, 0), 56, 142, 60);

	const x0 = 0.18,
		x1 = 0.82,
		y0 = 0.18,
		y1 = 0.82;
	const wh = 15,
		rh = 23;

	// Right roof slope (back face — draw first, partially visible above ridge)
	fillPoly(
		c,
		quad(iso, [x1, y0, wh], [0.5, y0, rh], [0.5, y1, rh], [x1, y1, wh]),
		...p.roofLight,
	);
	// Left roof slope (front face — prominent, covers back gable area)
	fillPoly(
		c,
		quad(iso, [x0, y0, wh], [0.5, y0, rh], [0.5, y1, rh], [x0, y1, wh]),
		...p.roofDark,
	);
	// Left wall (tx=x0, west face)
	fillPoly(
		c,
		quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]),
		...p.wallDark,
	);
	// Right wall (ty=y0, south face)
	fillPoly(
		c,
		quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]),
		...p.wallLight,
	);
	// Front gable triangle
	fillPoly(c, [iso(x0, y0, wh), iso(x1, y0, wh), iso(0.5, y0, rh)], ...p.gable);

	// Door
	fillPoly(
		c,
		quad(iso, [0.28, y0, 0], [0.42, y0, 0], [0.42, y0, 10], [0.28, y0, 10]),
		...p.door,
	);
	drawLine(c, ...iso(0.28, y0, 0), ...iso(0.28, y0, 10), ...OL);
	drawLine(c, ...iso(0.28, y0, 10), ...iso(0.42, y0, 10), ...OL);
	drawLine(c, ...iso(0.42, y0, 10), ...iso(0.42, y0, 0), ...OL);
	set(c, ...iso(0.39, y0, 5), 200, 180, 80);

	// Window right wall
	fillPoly(
		c,
		quad(iso, [0.56, y0, 6], [0.72, y0, 6], [0.72, y0, 12], [0.56, y0, 12]),
		...p.window,
	);
	drawLine(c, ...iso(0.56, y0, 6), ...iso(0.72, y0, 6), ...OL);
	drawLine(c, ...iso(0.72, y0, 6), ...iso(0.72, y0, 12), ...OL);
	drawLine(c, ...iso(0.72, y0, 12), ...iso(0.56, y0, 12), ...OL);
	drawLine(c, ...iso(0.56, y0, 12), ...iso(0.56, y0, 6), ...OL);
	drawLine(c, ...iso(0.64, y0, 6), ...iso(0.64, y0, 12), ...OL);
	drawLine(c, ...iso(0.56, y0, 9), ...iso(0.72, y0, 9), ...OL);

	// Window left wall
	fillPoly(
		c,
		quad(iso, [x0, 0.38, 6], [x0, 0.62, 6], [x0, 0.62, 12], [x0, 0.38, 12]),
		...p.window,
	);
	drawLine(c, ...iso(x0, 0.38, 6), ...iso(x0, 0.62, 6), ...OL);
	drawLine(c, ...iso(x0, 0.62, 6), ...iso(x0, 0.62, 12), ...OL);
	drawLine(c, ...iso(x0, 0.62, 12), ...iso(x0, 0.38, 12), ...OL);
	drawLine(c, ...iso(x0, 0.38, 12), ...iso(x0, 0.38, 6), ...OL);
	drawLine(c, ...iso(x0, 0.5, 6), ...iso(x0, 0.5, 12), ...OL);
	drawLine(c, ...iso(x0, 0.38, 9), ...iso(x0, 0.62, 9), ...OL);

	// Visible outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL); // W-S base
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL); // S column
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL); // W column
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL); // S-E base
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL); // E column
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL); // W eave
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL); // E eave
	// Roof ridge and gable edges
	drawLine(c, ...iso(x0, y0, wh), ...iso(0.5, y0, rh), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(0.5, y0, rh), ...OL);
	drawLine(c, ...iso(0.5, y0, rh), ...iso(0.5, y1, rh), ...OL); // ridge line
	drawLine(c, ...iso(x0, y1, wh), ...iso(0.5, y1, rh), ...OL); // back-left roof edge
	drawLine(c, ...iso(x1, y1, wh), ...iso(0.5, y1, rh), ...OL); // back-right roof edge
}

/** R2: Mid-density apartment block — flat roof, multiple window rows. */
function drawR2(c, iso) {
	const p = PALETTES.r;
	const OL = p.outline;
	const x0 = 0.08,
		x1 = 0.92,
		y0 = 0.08,
		y1 = 0.92;
	const wh = 28;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, p);

	// Door
	fillPoly(
		c,
		quad(iso, [0.38, y0, 0], [0.62, y0, 0], [0.62, y0, 12], [0.38, y0, 12]),
		...p.door,
	);
	drawLine(c, ...iso(0.38, y0, 0), ...iso(0.38, y0, 12), ...OL);
	drawLine(c, ...iso(0.38, y0, 12), ...iso(0.62, y0, 12), ...OL);
	drawLine(c, ...iso(0.62, y0, 12), ...iso(0.62, y0, 0), ...OL);

	// Window rows (3 floors)
	for (let floor = 0; floor < 3; floor++) {
		const fBase = 4 + floor * 8;
		const fTop = fBase + 5;
		for (const wx of [0.2, 0.5, 0.75]) {
			const wx2 = wx + 0.12;
			if (floor === 0 && wx >= 0.35 && wx <= 0.65) continue;
			fillPoly(
				c,
				quad(
					iso,
					[wx, y0, fBase],
					[wx2, y0, fBase],
					[wx2, y0, fTop],
					[wx, y0, fTop],
				),
				...p.window,
			);
			drawLine(c, ...iso(wx, y0, fBase), ...iso(wx2, y0, fBase), ...OL);
			drawLine(c, ...iso(wx2, y0, fBase), ...iso(wx2, y0, fTop), ...OL);
			drawLine(c, ...iso(wx2, y0, fTop), ...iso(wx, y0, fTop), ...OL);
			drawLine(c, ...iso(wx, y0, fTop), ...iso(wx, y0, fBase), ...OL);
		}
		for (const wy of [0.2, 0.5, 0.75]) {
			const wy2 = wy + 0.12;
			fillPoly(
				c,
				quad(
					iso,
					[x0, wy, fBase],
					[x0, wy2, fBase],
					[x0, wy2, fTop],
					[x0, wy, fTop],
				),
				...p.window,
			);
			drawLine(c, ...iso(x0, wy, fBase), ...iso(x0, wy2, fBase), ...OL);
			drawLine(c, ...iso(x0, wy2, fBase), ...iso(x0, wy2, fTop), ...OL);
			drawLine(c, ...iso(x0, wy2, fTop), ...iso(x0, wy, fTop), ...OL);
			drawLine(c, ...iso(x0, wy, fTop), ...iso(x0, wy, fBase), ...OL);
		}
	}

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** R3: High-density tower — tall, narrow, many windows. */
function drawR3(c, iso) {
	const p = PALETTES.r;
	const OL = p.outline;
	const x0 = 0.12,
		x1 = 0.88,
		y0 = 0.12,
		y1 = 0.88;
	const wh = 50;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, p);

	// Door
	fillPoly(
		c,
		quad(iso, [0.35, y0, 0], [0.65, y0, 0], [0.65, y0, 12], [0.35, y0, 12]),
		...p.door,
	);

	// Window rows (6 floors)
	for (let floor = 0; floor < 6; floor++) {
		const fBase = 4 + floor * 7;
		const fTop = fBase + 4;
		if (floor === 0) continue;
		for (const wx of [0.2, 0.45, 0.7]) {
			const wx2 = wx + 0.12;
			fillPoly(
				c,
				quad(
					iso,
					[wx, y0, fBase],
					[wx2, y0, fBase],
					[wx2, y0, fTop],
					[wx, y0, fTop],
				),
				...p.window,
			);
			drawLine(c, ...iso(wx, y0, fBase), ...iso(wx2, y0, fTop), ...OL);
		}
		for (const wy of [0.2, 0.45, 0.7]) {
			const wy2 = wy + 0.12;
			fillPoly(
				c,
				quad(
					iso,
					[x0, wy, fBase],
					[x0, wy2, fBase],
					[x0, wy2, fTop],
					[x0, wy, fTop],
				),
				...p.window,
			);
			drawLine(c, ...iso(x0, wy, fBase), ...iso(x0, wy2, fTop), ...OL);
		}
	}

	// Red accent band at top
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		...p.accent,
	);
	fillPoly(
		c,
		quad(iso, [x0, y1, wh - 2], [x0, y0, wh - 2], [x0, y0, wh], [x0, y1, wh]),
		...p.accent,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** C1: Small shop — awning over front, display window. */
function drawC1(c, iso) {
	const p = PALETTES.c;
	const OL = p.outline;
	const x0 = 0.1,
		x1 = 0.9,
		y0 = 0.1,
		y1 = 0.9;
	const wh = 14;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, { ...p, roofDark: p.roofLight });

	// Large display window (right wall)
	fillPoly(
		c,
		quad(iso, [0.18, y0, 2], [0.82, y0, 2], [0.82, y0, 10], [0.18, y0, 10]),
		...p.window,
	);
	drawLine(c, ...iso(0.18, y0, 2), ...iso(0.82, y0, 2), ...OL);
	drawLine(c, ...iso(0.82, y0, 2), ...iso(0.82, y0, 10), ...OL);
	drawLine(c, ...iso(0.82, y0, 10), ...iso(0.18, y0, 10), ...OL);
	drawLine(c, ...iso(0.18, y0, 10), ...iso(0.18, y0, 2), ...OL);
	// Door in window
	fillPoly(
		c,
		quad(iso, [0.42, y0, 0], [0.58, y0, 0], [0.58, y0, 10], [0.42, y0, 10]),
		...p.door,
	);
	drawLine(c, ...iso(0.42, y0, 0), ...iso(0.42, y0, 10), ...OL);
	drawLine(c, ...iso(0.58, y0, 0), ...iso(0.58, y0, 10), ...OL);

	// Left wall window
	fillPoly(
		c,
		quad(iso, [x0, 0.25, 2], [x0, 0.75, 2], [x0, 0.75, 10], [x0, 0.25, 10]),
		...p.window,
	);
	drawLine(c, ...iso(x0, 0.25, 2), ...iso(x0, 0.75, 2), ...OL);
	drawLine(c, ...iso(x0, 0.75, 2), ...iso(x0, 0.75, 10), ...OL);
	drawLine(c, ...iso(x0, 0.75, 10), ...iso(x0, 0.25, 10), ...OL);
	drawLine(c, ...iso(x0, 0.25, 10), ...iso(x0, 0.25, 2), ...OL);

	// Awning
	fillPoly(
		c,
		quad(
			iso,
			[x0 - 0.06, y0 - 0.06, wh - 2],
			[x1 + 0.06, y0 - 0.06, wh - 2],
			[x1, y0, wh],
			[x0, y0, wh],
		),
		...p.accent,
	);

	// Blue accent stripe
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 1], [x1, y0, wh - 1], [x1, y0, wh], [x0, y0, wh]),
		...p.accent,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 1], [x0, y1, wh - 1], [x0, y1, wh], [x0, y0, wh]),
		...p.accent,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** C2: Office building — glass curtain wall, bands of windows. */
function drawC2(c, iso) {
	const p = PALETTES.c;
	const OL = p.outline;
	const x0 = 0.05,
		x1 = 0.95,
		y0 = 0.05,
		y1 = 0.95;
	const wh = 32;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, p);

	// Horizontal window bands (curtain wall)
	for (let floor = 0; floor < 4; floor++) {
		const fBase = 3 + floor * 7;
		const fTop = fBase + 4;
		fillPoly(
			c,
			quad(
				iso,
				[x0 + 0.04, y0, fBase],
				[x1 - 0.04, y0, fBase],
				[x1 - 0.04, y0, fTop],
				[x0 + 0.04, y0, fTop],
			),
			...p.window,
		);
		fillPoly(
			c,
			quad(
				iso,
				[x0, y0 + 0.04, fBase],
				[x0, y1 - 0.04, fBase],
				[x0, y1 - 0.04, fTop],
				[x0, y0 + 0.04, fTop],
			),
			...p.window,
		);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x1, y0, fBase), ...OL);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x0, y1, fBase), ...OL);
	}

	// Door
	fillPoly(
		c,
		quad(iso, [0.4, y0, 0], [0.6, y0, 0], [0.6, y0, 9], [0.4, y0, 9]),
		...p.door,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** C3: Skyscraper — tall glass tower. */
function drawC3(c, iso) {
	const p = PALETTES.c;
	const OL = p.outline;
	const x0 = 0.1,
		x1 = 0.9,
		y0 = 0.1,
		y1 = 0.9;
	const wh = 58;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, p);

	// Window bands (8 floors)
	for (let floor = 0; floor < 8; floor++) {
		const fBase = 3 + floor * 6.5;
		const fTop = fBase + 4;
		fillPoly(
			c,
			quad(
				iso,
				[x0 + 0.03, y0, fBase],
				[x1 - 0.03, y0, fBase],
				[x1 - 0.03, y0, fTop],
				[x0 + 0.03, y0, fTop],
			),
			...p.window,
		);
		fillPoly(
			c,
			quad(
				iso,
				[x0, y0 + 0.03, fBase],
				[x0, y1 - 0.03, fBase],
				[x0, y1 - 0.03, fTop],
				[x0, y0 + 0.03, fTop],
			),
			...p.window,
		);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x1, y0, fBase), ...OL);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x0, y1, fBase), ...OL);
	}

	// Entrance
	fillPoly(
		c,
		quad(iso, [0.35, y0, 0], [0.65, y0, 0], [0.65, y0, 10], [0.35, y0, 10]),
		...p.window,
	);
	drawLine(c, ...iso(0.5, y0, 0), ...iso(0.5, y0, 10), ...OL);

	// Crown accent
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		...p.accent,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		...p.accent,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** I1: Small warehouse/shed — corrugated look, loading door, lean-to roof. */
function drawI1(c, iso) {
	const p = PALETTES.i;
	const OL = p.outline;
	const x0 = 0.1,
		x1 = 0.9,
		y0 = 0.1,
		y1 = 0.9;
	const wh = 12;
	const frontH = wh + 2; // lean-to: front is taller

	// Sloped roof (front higher, back lower)
	fillPoly(
		c,
		quad(iso, [x0, y0, frontH], [x1, y0, frontH], [x1, y1, wh], [x0, y1, wh]),
		...p.roofLight,
	);
	// Left wall (tx=x0, west face — note different heights front vs back)
	fillPoly(
		c,
		quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, frontH], [x0, y1, wh]),
		...p.wallDark,
	);
	// Right wall (ty=y0, south face)
	fillPoly(
		c,
		quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, frontH], [x0, y0, frontH]),
		...p.wallLight,
	);

	// Loading door (large roll-up)
	fillPoly(
		c,
		quad(iso, [0.2, y0, 0], [0.7, y0, 0], [0.7, y0, 10], [0.2, y0, 10]),
		...p.door,
	);
	for (let s = 2; s < 10; s += 2) {
		drawLine(c, ...iso(0.2, y0, s), ...iso(0.7, y0, s), ...OL);
	}
	drawLine(c, ...iso(0.2, y0, 0), ...iso(0.2, y0, 10), ...OL);
	drawLine(c, ...iso(0.2, y0, 10), ...iso(0.7, y0, 10), ...OL);
	drawLine(c, ...iso(0.7, y0, 10), ...iso(0.7, y0, 0), ...OL);

	// Corrugated lines on left wall
	for (let s = 0.25; s < 0.9; s += 0.12) {
		drawLine(c, ...iso(x0, s, 0), ...iso(x0, s, wh), ...OL);
	}

	// Rust accent stripe at front roof edge
	fillPoly(
		c,
		quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y0, frontH], [x0, y0, frontH]),
		...p.accent,
	);

	// Visible outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL); // W-S base
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, frontH), ...OL); // S column
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL); // W column
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL); // S-E base
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, frontH), ...OL); // E column
	drawLine(c, ...iso(x0, y0, frontH), ...iso(x1, y0, frontH), ...OL); // front eave
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL); // back eave (roof edge)
	drawLine(c, ...iso(x0, y1, wh), ...iso(x0, y0, frontH), ...OL); // left roof slope edge
	drawLine(c, ...iso(x1, y1, wh), ...iso(x1, y0, frontH), ...OL); // right roof slope edge
}

/** I2: Medium factory — smokestack. */
function drawI2(c, iso) {
	const p = PALETTES.i;
	const OL = p.outline;
	const x0 = 0.05,
		x1 = 0.95,
		y0 = 0.05,
		y1 = 0.95;
	const wh = 18;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, { ...p, roofDark: p.roofLight });

	// Smokestack (small element on roof — draw all faces for completeness)
	const sx0 = 0.7,
		sx1 = 0.85,
		sy0 = 0.6,
		sy1 = 0.75;
	const sh = 32;
	// Stack cap
	fillPoly(
		c,
		quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]),
		80,
		75,
		65,
	);
	// Stack visible walls (front-facing: left=tx=sx0, right=ty=sy0)
	fillPoly(
		c,
		quad(iso, [sx0, sy1, wh], [sx0, sy0, wh], [sx0, sy0, sh], [sx0, sy1, sh]),
		...p.wallDark,
	);
	fillPoly(
		c,
		quad(iso, [sx0, sy0, wh], [sx1, sy0, wh], [sx1, sy0, sh], [sx0, sy0, sh]),
		...p.wallLight,
	);
	// Stack outlines (visible edges only)
	drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL); // W column
	drawLine(c, ...iso(sx0, sy0, wh), ...iso(sx0, sy0, sh), ...OL); // S column
	drawLine(c, ...iso(sx1, sy0, wh), ...iso(sx1, sy0, sh), ...OL); // E column
	drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL); // cap S-E
	drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL); // cap S-W
	drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL); // cap E-N
	drawLine(c, ...iso(sx0, sy1, sh), ...iso(sx1, sy1, sh), ...OL); // cap W-N

	// Loading doors
	fillPoly(
		c,
		quad(iso, [0.1, y0, 0], [0.4, y0, 0], [0.4, y0, 12], [0.1, y0, 12]),
		...p.door,
	);
	fillPoly(
		c,
		quad(iso, [0.55, y0, 0], [0.85, y0, 0], [0.85, y0, 12], [0.55, y0, 12]),
		...p.door,
	);
	for (let s = 3; s < 12; s += 3) {
		drawLine(c, ...iso(0.1, y0, s), ...iso(0.4, y0, s), ...OL);
		drawLine(c, ...iso(0.55, y0, s), ...iso(0.85, y0, s), ...OL);
	}

	// Windows on left wall
	for (const wy of [0.2, 0.5, 0.75]) {
		fillPoly(
			c,
			quad(
				iso,
				[x0, wy, 8],
				[x0, wy + 0.1, 8],
				[x0, wy + 0.1, 14],
				[x0, wy, 14],
			),
			...p.window,
		);
	}

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** I3: Heavy industry — large plant with silos. */
function drawI3(c, iso) {
	const p = PALETTES.i;
	const OL = p.outline;
	const x0 = 0.05,
		x1 = 0.95,
		y0 = 0.05,
		y1 = 0.95;
	const wh = 24;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, { ...p, roofDark: p.roofLight });

	// Two smokestacks
	for (const [sx0, sy0] of [
		[0.65, 0.55],
		[0.75, 0.7],
	]) {
		const sx1 = sx0 + 0.12;
		const sy1 = sy0 + 0.12;
		const sh = sx0 < 0.7 ? 38 : 34;
		// Cap
		fillPoly(
			c,
			quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]),
			80,
			75,
			65,
		);
		// Visible walls
		fillPoly(
			c,
			quad(iso, [sx0, sy1, wh], [sx0, sy0, wh], [sx0, sy0, sh], [sx0, sy1, sh]),
			...p.wallDark,
		);
		fillPoly(
			c,
			quad(iso, [sx0, sy0, wh], [sx1, sy0, wh], [sx1, sy0, sh], [sx0, sy0, sh]),
			...p.wallLight,
		);
		// Outlines
		drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, wh), ...iso(sx0, sy0, sh), ...OL);
		drawLine(c, ...iso(sx1, sy0, wh), ...iso(sx1, sy0, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL);
		drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy1, sh), ...iso(sx1, sy1, sh), ...OL);
	}

	// Loading door
	fillPoly(
		c,
		quad(iso, [0.1, y0, 0], [0.45, y0, 0], [0.45, y0, 14], [0.1, y0, 14]),
		...p.door,
	);
	for (let s = 3; s < 14; s += 3) {
		drawLine(c, ...iso(0.1, y0, s), ...iso(0.45, y0, s), ...OL);
	}

	// Rust accent band
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		...p.accent,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		...p.accent,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

// ---- Generic building for cluster sprites -----------------------------------

function drawGenericBuilding(c, iso, zone, tileSize, wallHeight) {
	const p = PALETTES[zone];
	const OL = p.outline;
	const margin = 0.04 * tileSize;
	const x0 = margin,
		x1 = tileSize - margin;
	const y0 = margin,
		y1 = tileSize - margin;
	const wh = wallHeight;

	drawFlatBox(c, iso, x0, y0, x1, y1, wh, p);

	// Window rows
	const numFloors = Math.floor(wh / 7);
	const wallLen = x1 - x0;
	const numWindowsPerWall = Math.max(2, Math.floor(wallLen / 0.25));
	const winSpacing = wallLen / (numWindowsPerWall + 1);
	const winW = winSpacing * 0.6;

	for (let floor = 0; floor < numFloors; floor++) {
		const fBase = 3 + floor * 7;
		const fTop = fBase + 4;
		if (floor === 0 && zone !== "c") continue;
		for (let w = 0; w < numWindowsPerWall; w++) {
			const wx = x0 + winSpacing * (w + 1) - winW / 2;
			fillPoly(
				c,
				quad(
					iso,
					[wx, y0, fBase],
					[wx + winW, y0, fBase],
					[wx + winW, y0, fTop],
					[wx, y0, fTop],
				),
				...p.window,
			);
		}
		for (let w = 0; w < numWindowsPerWall; w++) {
			const wy = y0 + winSpacing * (w + 1) - winW / 2;
			fillPoly(
				c,
				quad(
					iso,
					[x0, wy, fBase],
					[x0, wy + winW, fBase],
					[x0, wy + winW, fTop],
					[x0, wy, fTop],
				),
				...p.window,
			);
		}
	}

	// Door/entrance
	const doorW = wallLen * 0.15;
	const mid = (x0 + x1) / 2;
	fillPoly(
		c,
		quad(
			iso,
			[mid - doorW, y0, 0],
			[mid + doorW, y0, 0],
			[mid + doorW, y0, 10],
			[mid - doorW, y0, 10],
		),
		...p.door,
	);

	// Zone-specific details
	if (zone === "i" && tileSize >= 2) {
		const sx0 = x1 - 0.25,
			sx1 = x1 - 0.12;
		const sy0 = y1 - 0.35,
			sy1 = y1 - 0.22;
		const sh = wh + 16;
		fillPoly(
			c,
			quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]),
			80,
			75,
			65,
		);
		fillPoly(
			c,
			quad(iso, [sx0, sy1, wh], [sx0, sy0, wh], [sx0, sy0, sh], [sx0, sy1, sh]),
			...p.wallDark,
		);
		fillPoly(
			c,
			quad(iso, [sx0, sy0, wh], [sx1, sy0, wh], [sx1, sy0, sh], [sx0, sy0, sh]),
			...p.wallLight,
		);
		drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, wh), ...iso(sx0, sy0, sh), ...OL);
		drawLine(c, ...iso(sx1, sy0, wh), ...iso(sx1, sy0, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL);
		drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy1, sh), ...iso(sx1, sy1, sh), ...OL);
	}

	if (zone === "r" && tileSize >= 3) {
		const rx0 = x0 + wallLen * 0.1,
			rx1 = x1 - wallLen * 0.1;
		const ridgeH = wh + 8;
		fillPoly(
			c,
			quad(
				iso,
				[rx1, y0, wh],
				[(rx0 + rx1) / 2, y0, ridgeH],
				[(rx0 + rx1) / 2, y1, ridgeH],
				[rx1, y1, wh],
			),
			...p.roofLight,
		);
		fillPoly(
			c,
			quad(
				iso,
				[rx0, y0, wh],
				[(rx0 + rx1) / 2, y0, ridgeH],
				[(rx0 + rx1) / 2, y1, ridgeH],
				[rx0, y1, wh],
			),
			...p.roofDark,
		);
		drawLine(
			c,
			...iso((rx0 + rx1) / 2, y0, ridgeH),
			...iso((rx0 + rx1) / 2, y1, ridgeH),
			...OL,
		);
	}

	// Accent band at top
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		...p.accent,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		...p.accent,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

// ---- Canvas size calculator -------------------------------------------------

function canvasSize(tileW, tileH, wallHeight) {
	const w = (tileW + tileH) * 32;
	const baseH = (tileW + tileH) * 16;
	const h = baseH + wallHeight;
	return { w, h };
}

// ---- Civic building generators ----------------------------------------------

/** Coal plant: dark building with tall smokestack, industrial look. */
function drawCivicCoalPlant(c, iso) {
	const OL = [45, 35, 30];
	const x0 = 0.08,
		x1 = 0.92,
		y0 = 0.08,
		y1 = 0.92;
	const wh = 16;

	// Main building
	const pal = {
		wallLight: [140, 120, 95],
		wallDark: [115, 98, 78],
		roofDark: [100, 85, 70],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Smokestack
	const sx0 = 0.6,
		sx1 = 0.78,
		sy0 = 0.5,
		sy1 = 0.68;
	const sh = 38;
	fillPoly(
		c,
		quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]),
		70,
		60,
		50,
	);
	fillPoly(
		c,
		quad(iso, [sx0, sy1, wh], [sx0, sy0, wh], [sx0, sy0, sh], [sx0, sy1, sh]),
		105,
		88,
		68,
	);
	fillPoly(
		c,
		quad(iso, [sx0, sy0, wh], [sx1, sy0, wh], [sx1, sy0, sh], [sx0, sy0, sh]),
		130,
		112,
		88,
	);
	drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL);
	drawLine(c, ...iso(sx0, sy0, wh), ...iso(sx0, sy0, sh), ...OL);
	drawLine(c, ...iso(sx1, sy0, wh), ...iso(sx1, sy0, sh), ...OL);
	drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL);
	drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL);
	drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL);
	drawLine(c, ...iso(sx0, sy1, sh), ...iso(sx1, sy1, sh), ...OL);

	// Smoke wisps (small translucent marks)
	set(c, ...iso(0.68, 0.58, sh + 3), 100, 95, 90, 120);
	set(c, ...iso(0.66, 0.56, sh + 6), 110, 105, 100, 90);
	set(c, ...iso(0.7, 0.6, sh + 5), 105, 100, 95, 80);

	// Loading door
	fillPoly(
		c,
		quad(iso, [0.15, y0, 0], [0.45, y0, 0], [0.45, y0, 10], [0.15, y0, 10]),
		85,
		70,
		50,
	);
	for (let s = 2; s < 10; s += 2) {
		drawLine(c, ...iso(0.15, y0, s), ...iso(0.45, y0, s), ...OL);
	}

	// Coal pile detail on left wall
	fillPoly(
		c,
		quad(iso, [x0, 0.3, 0], [x0, 0.7, 0], [x0, 0.7, 5], [x0, 0.3, 5]),
		50,
		45,
		40,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Solar plant: low building with angled solar panels on roof. */
function drawCivicSolarPlant(c, iso) {
	const OL = [50, 55, 40];
	const x0 = 0.05,
		x1 = 0.95,
		y0 = 0.05,
		y1 = 0.95;
	const wh = 8;

	// Low base building
	const pal = {
		wallLight: [200, 195, 185],
		wallDark: [175, 170, 160],
		roofDark: [160, 155, 145],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Solar panels on roof (3 rows of tilted blue panels)
	for (let row = 0; row < 3; row++) {
		const py0 = 0.15 + row * 0.28;
		const py1 = py0 + 0.2;
		const panelBase = wh;
		const panelTop = wh + 4;
		// Panel face (tilted toward camera = ty=py0 face visible)
		fillPoly(
			c,
			quad(
				iso,
				[0.15, py0, panelTop],
				[0.85, py0, panelTop],
				[0.85, py1, panelBase],
				[0.15, py1, panelBase],
			),
			60,
			100,
			180,
		);
		// Panel top edge highlight
		drawLine(
			c,
			...iso(0.15, py0, panelTop),
			...iso(0.85, py0, panelTop),
			80,
			130,
			220,
		);
		// Grid lines on panel
		drawLine(
			c,
			...iso(0.5, py0, panelTop),
			...iso(0.5, py1, panelBase),
			50,
			85,
			155,
		);
		drawLine(
			c,
			...iso(0.15, (py0 + py1) / 2, (panelBase + panelTop) / 2),
			...iso(0.85, (py0 + py1) / 2, (panelBase + panelTop) / 2),
			50,
			85,
			155,
		);
		// Panel outline
		drawLine(
			c,
			...iso(0.15, py0, panelTop),
			...iso(0.15, py1, panelBase),
			...OL,
		);
		drawLine(
			c,
			...iso(0.85, py0, panelTop),
			...iso(0.85, py1, panelBase),
			...OL,
		);
		drawLine(
			c,
			...iso(0.15, py1, panelBase),
			...iso(0.85, py1, panelBase),
			...OL,
		);
	}

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Water pump: blue-accented utility building with water tower / tank. */
function drawCivicWaterPump(c, iso) {
	const OL = [30, 50, 65];
	const x0 = 0.1,
		x1 = 0.9,
		y0 = 0.1,
		y1 = 0.9;
	const wh = 10;

	// Base building
	const pal = {
		wallLight: [170, 200, 220],
		wallDark: [140, 170, 195],
		roofDark: [120, 150, 175],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Water tank (cylindrical, approximated as box)
	const tx0 = 0.3,
		tx1 = 0.7,
		ty0 = 0.3,
		ty1 = 0.7;
	const th = 30;
	// Tank cap (oval-ish diamond)
	fillPoly(
		c,
		quad(iso, [tx0, ty0, th], [tx1, ty0, th], [tx1, ty1, th], [tx0, ty1, th]),
		80,
		160,
		220,
	);
	// Tank walls
	fillPoly(
		c,
		quad(iso, [tx0, ty1, wh], [tx0, ty0, wh], [tx0, ty0, th], [tx0, ty1, th]),
		56,
		140,
		200,
	);
	fillPoly(
		c,
		quad(iso, [tx0, ty0, wh], [tx1, ty0, wh], [tx1, ty0, th], [tx0, ty0, th]),
		70,
		155,
		215,
	);
	// Tank band stripes
	for (const h of [wh + 5, wh + 12]) {
		drawLine(c, ...iso(tx0, ty1, h), ...iso(tx0, ty0, h), 45, 120, 180);
		drawLine(c, ...iso(tx0, ty0, h), ...iso(tx1, ty0, h), 55, 130, 190);
	}
	// Tank outlines
	drawLine(c, ...iso(tx0, ty1, wh), ...iso(tx0, ty1, th), ...OL);
	drawLine(c, ...iso(tx0, ty0, wh), ...iso(tx0, ty0, th), ...OL);
	drawLine(c, ...iso(tx1, ty0, wh), ...iso(tx1, ty0, th), ...OL);
	drawLine(c, ...iso(tx0, ty0, th), ...iso(tx1, ty0, th), ...OL);
	drawLine(c, ...iso(tx1, ty0, th), ...iso(tx1, ty1, th), ...OL);
	drawLine(c, ...iso(tx0, ty0, th), ...iso(tx0, ty1, th), ...OL);
	drawLine(c, ...iso(tx0, ty1, th), ...iso(tx1, ty1, th), ...OL);

	// Pipe from tank to ground (visible on right wall side)
	drawLine(
		c,
		...iso(tx1 - 0.05, ty0, th - 2),
		...iso(tx1 - 0.05, ty0, 0),
		45,
		120,
		180,
	);
	drawLine(
		c,
		...iso(tx1 - 0.03, ty0, th - 2),
		...iso(tx1 - 0.03, ty0, 0),
		60,
		140,
		200,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Police station: dark blue building with badge-like accent, garage door. */
function drawCivicPolice(c, iso) {
	const OL = [20, 35, 60];
	const x0 = 0.08,
		x1 = 0.92,
		y0 = 0.08,
		y1 = 0.92;
	const wh = 18;

	const pal = {
		wallLight: [160, 175, 200],
		wallDark: [130, 145, 175],
		roofDark: [100, 115, 145],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Garage door (for patrol cars)
	fillPoly(
		c,
		quad(iso, [0.15, y0, 0], [0.48, y0, 0], [0.48, y0, 12], [0.15, y0, 12]),
		80,
		95,
		120,
	);
	for (let s = 3; s < 12; s += 3) {
		drawLine(c, ...iso(0.15, y0, s), ...iso(0.48, y0, s), ...OL);
	}
	drawLine(c, ...iso(0.15, y0, 0), ...iso(0.15, y0, 12), ...OL);
	drawLine(c, ...iso(0.15, y0, 12), ...iso(0.48, y0, 12), ...OL);
	drawLine(c, ...iso(0.48, y0, 12), ...iso(0.48, y0, 0), ...OL);

	// Front door
	fillPoly(
		c,
		quad(iso, [0.6, y0, 0], [0.78, y0, 0], [0.78, y0, 11], [0.6, y0, 11]),
		70,
		80,
		110,
	);
	drawLine(c, ...iso(0.6, y0, 0), ...iso(0.6, y0, 11), ...OL);
	drawLine(c, ...iso(0.6, y0, 11), ...iso(0.78, y0, 11), ...OL);
	drawLine(c, ...iso(0.78, y0, 11), ...iso(0.78, y0, 0), ...OL);

	// Windows on left wall
	for (const wy of [0.25, 0.55]) {
		fillPoly(
			c,
			quad(
				iso,
				[x0, wy, 6],
				[x0, wy + 0.18, 6],
				[x0, wy + 0.18, 13],
				[x0, wy, 13],
			),
			145,
			190,
			230,
		);
		drawLine(c, ...iso(x0, wy, 6), ...iso(x0, wy + 0.18, 6), ...OL);
		drawLine(c, ...iso(x0, wy + 0.18, 6), ...iso(x0, wy + 0.18, 13), ...OL);
		drawLine(c, ...iso(x0, wy + 0.18, 13), ...iso(x0, wy, 13), ...OL);
		drawLine(c, ...iso(x0, wy, 13), ...iso(x0, wy, 6), ...OL);
	}

	// Blue accent stripe at top
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		29,
		78,
		216,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		20,
		60,
		180,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Fire station: red building with large garage door and tower. */
function drawCivicFireStation(c, iso) {
	const OL = [70, 25, 20];
	const x0 = 0.08,
		x1 = 0.92,
		y0 = 0.08,
		y1 = 0.92;
	const wh = 16;

	const pal = {
		wallLight: [220, 100, 80],
		wallDark: [190, 80, 60],
		roofDark: [160, 65, 50],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Large garage door
	fillPoly(
		c,
		quad(iso, [0.15, y0, 0], [0.7, y0, 0], [0.7, y0, 13], [0.15, y0, 13]),
		180,
		175,
		165,
	);
	for (let s = 3; s < 13; s += 3) {
		drawLine(c, ...iso(0.15, y0, s), ...iso(0.7, y0, s), ...OL);
	}
	drawLine(c, ...iso(0.15, y0, 0), ...iso(0.15, y0, 13), ...OL);
	drawLine(c, ...iso(0.15, y0, 13), ...iso(0.7, y0, 13), ...OL);
	drawLine(c, ...iso(0.7, y0, 13), ...iso(0.7, y0, 0), ...OL);

	// Hose tower (small tower on back-right of roof)
	const tx0 = 0.65,
		tx1 = 0.82,
		ty0 = 0.6,
		ty1 = 0.78;
	const th = 28;
	fillPoly(
		c,
		quad(iso, [tx0, ty0, th], [tx1, ty0, th], [tx1, ty1, th], [tx0, ty1, th]),
		180,
		70,
		55,
	);
	fillPoly(
		c,
		quad(iso, [tx0, ty1, wh], [tx0, ty0, wh], [tx0, ty0, th], [tx0, ty1, th]),
		175,
		65,
		48,
	);
	fillPoly(
		c,
		quad(iso, [tx0, ty0, wh], [tx1, ty0, wh], [tx1, ty0, th], [tx0, ty0, th]),
		200,
		85,
		65,
	);
	drawLine(c, ...iso(tx0, ty1, wh), ...iso(tx0, ty1, th), ...OL);
	drawLine(c, ...iso(tx0, ty0, wh), ...iso(tx0, ty0, th), ...OL);
	drawLine(c, ...iso(tx1, ty0, wh), ...iso(tx1, ty0, th), ...OL);
	drawLine(c, ...iso(tx0, ty0, th), ...iso(tx1, ty0, th), ...OL);
	drawLine(c, ...iso(tx1, ty0, th), ...iso(tx1, ty1, th), ...OL);
	drawLine(c, ...iso(tx0, ty0, th), ...iso(tx0, ty1, th), ...OL);
	drawLine(c, ...iso(tx0, ty1, th), ...iso(tx1, ty1, th), ...OL);

	// White stripe at garage level
	fillPoly(
		c,
		quad(iso, [x0, y0, 14], [x1, y0, 14], [x1, y0, wh], [x0, y0, wh]),
		240,
		235,
		230,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, 14], [x0, y1, 14], [x0, y1, wh], [x0, y0, wh]),
		220,
		215,
		210,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Hospital: white/pink building with cross symbol, taller. */
function drawCivicHospital(c, iso) {
	const OL = [80, 50, 60];
	const x0 = 0.06,
		x1 = 0.94,
		y0 = 0.06,
		y1 = 0.94;
	const wh = 26;

	const pal = {
		wallLight: [240, 230, 235],
		wallDark: [215, 205, 212],
		roofDark: [195, 185, 192],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Red cross on right wall
	fillPoly(
		c,
		quad(iso, [0.42, y0, 14], [0.58, y0, 14], [0.58, y0, 24], [0.42, y0, 24]),
		220,
		50,
		50,
	);
	fillPoly(
		c,
		quad(iso, [0.35, y0, 17], [0.65, y0, 17], [0.65, y0, 21], [0.35, y0, 21]),
		220,
		50,
		50,
	);

	// Red cross on left wall
	fillPoly(
		c,
		quad(iso, [x0, 0.42, 14], [x0, 0.58, 14], [x0, 0.58, 24], [x0, 0.42, 24]),
		200,
		40,
		40,
	);
	fillPoly(
		c,
		quad(iso, [x0, 0.35, 17], [x0, 0.65, 17], [x0, 0.65, 21], [x0, 0.35, 21]),
		200,
		40,
		40,
	);

	// Entrance
	fillPoly(
		c,
		quad(iso, [0.35, y0, 0], [0.65, y0, 0], [0.65, y0, 12], [0.35, y0, 12]),
		160,
		210,
		240,
	);
	drawLine(c, ...iso(0.35, y0, 0), ...iso(0.35, y0, 12), ...OL);
	drawLine(c, ...iso(0.35, y0, 12), ...iso(0.65, y0, 12), ...OL);
	drawLine(c, ...iso(0.65, y0, 12), ...iso(0.65, y0, 0), ...OL);
	drawLine(c, ...iso(0.5, y0, 0), ...iso(0.5, y0, 12), ...OL);

	// Window rows
	for (let floor = 0; floor < 2; floor++) {
		const fBase = 4 + floor * 10;
		const fTop = fBase + 5;
		for (const wy of [0.2, 0.5, 0.72]) {
			fillPoly(
				c,
				quad(
					iso,
					[x0, wy, fBase],
					[x0, wy + 0.12, fBase],
					[x0, wy + 0.12, fTop],
					[x0, wy, fTop],
				),
				160,
				210,
				240,
			);
		}
	}

	// Pink accent stripe
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		244,
		114,
		182,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		220,
		95,
		160,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** School: gold/warm building with windows, flag. */
function drawCivicSchool(c, iso) {
	const OL = [65, 55, 30];
	const x0 = 0.06,
		x1 = 0.94,
		y0 = 0.06,
		y1 = 0.94;
	const wh = 16;

	const pal = {
		wallLight: [235, 210, 160],
		wallDark: [210, 185, 135],
		roofDark: [185, 160, 110],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Door
	fillPoly(
		c,
		quad(iso, [0.4, y0, 0], [0.6, y0, 0], [0.6, y0, 11], [0.4, y0, 11]),
		120,
		85,
		50,
	);
	drawLine(c, ...iso(0.4, y0, 0), ...iso(0.4, y0, 11), ...OL);
	drawLine(c, ...iso(0.4, y0, 11), ...iso(0.6, y0, 11), ...OL);
	drawLine(c, ...iso(0.6, y0, 11), ...iso(0.6, y0, 0), ...OL);

	// Windows (two rows)
	for (const wx of [0.14, 0.7]) {
		fillPoly(
			c,
			quad(
				iso,
				[wx, y0, 5],
				[wx + 0.14, y0, 5],
				[wx + 0.14, y0, 12],
				[wx, y0, 12],
			),
			160,
			210,
			240,
		);
		drawLine(c, ...iso(wx, y0, 5), ...iso(wx + 0.14, y0, 5), ...OL);
		drawLine(c, ...iso(wx + 0.14, y0, 5), ...iso(wx + 0.14, y0, 12), ...OL);
		drawLine(c, ...iso(wx + 0.14, y0, 12), ...iso(wx, y0, 12), ...OL);
		drawLine(c, ...iso(wx, y0, 12), ...iso(wx, y0, 5), ...OL);
		drawLine(c, ...iso(wx + 0.07, y0, 5), ...iso(wx + 0.07, y0, 12), ...OL);
	}

	// Left wall windows
	for (const wy of [0.2, 0.5, 0.75]) {
		fillPoly(
			c,
			quad(
				iso,
				[x0, wy, 5],
				[x0, wy + 0.1, 5],
				[x0, wy + 0.1, 12],
				[x0, wy, 12],
			),
			160,
			210,
			240,
		);
		drawLine(c, ...iso(x0, wy, 5), ...iso(x0, wy + 0.1, 5), ...OL);
		drawLine(c, ...iso(x0, wy + 0.1, 5), ...iso(x0, wy + 0.1, 12), ...OL);
		drawLine(c, ...iso(x0, wy + 0.1, 12), ...iso(x0, wy, 12), ...OL);
		drawLine(c, ...iso(x0, wy, 12), ...iso(x0, wy, 5), ...OL);
	}

	// Flagpole on roof
	drawLine(c, ...iso(0.8, 0.2, wh), ...iso(0.8, 0.2, wh + 14), 100, 100, 100);
	// Flag
	fillPoly(
		c,
		[iso(0.8, 0.2, wh + 14), iso(0.8, 0.2, wh + 10), iso(0.8, 0.12, wh + 12)],
		200,
		50,
		50,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** College: purple-accented, taller academic building with columns. */
function drawCivicCollege(c, iso) {
	const OL = [50, 30, 65];
	const x0 = 0.06,
		x1 = 0.94,
		y0 = 0.06,
		y1 = 0.94;
	const wh = 24;

	const pal = {
		wallLight: [210, 195, 225],
		wallDark: [185, 170, 200],
		roofDark: [160, 145, 175],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Entrance with columns (right wall)
	fillPoly(
		c,
		quad(iso, [0.3, y0, 0], [0.7, y0, 0], [0.7, y0, 14], [0.3, y0, 14]),
		170,
		155,
		190,
	);
	// Two columns
	for (const cx of [0.35, 0.62]) {
		fillPoly(
			c,
			quad(
				iso,
				[cx, y0, 0],
				[cx + 0.05, y0, 0],
				[cx + 0.05, y0, 14],
				[cx, y0, 14],
			),
			230,
			225,
			220,
		);
		drawLine(c, ...iso(cx, y0, 0), ...iso(cx, y0, 14), ...OL);
		drawLine(c, ...iso(cx + 0.05, y0, 0), ...iso(cx + 0.05, y0, 14), ...OL);
	}
	// Pediment (triangular top)
	fillPoly(
		c,
		[iso(0.25, y0, 14), iso(0.75, y0, 14), iso(0.5, y0, 19)],
		195,
		180,
		215,
	);
	drawLine(c, ...iso(0.25, y0, 14), ...iso(0.5, y0, 19), ...OL);
	drawLine(c, ...iso(0.75, y0, 14), ...iso(0.5, y0, 19), ...OL);
	drawLine(c, ...iso(0.25, y0, 14), ...iso(0.75, y0, 14), ...OL);

	// Window rows (2 floors)
	for (let floor = 0; floor < 2; floor++) {
		const fBase = 4 + floor * 9;
		const fTop = fBase + 5;
		for (const wy of [0.18, 0.42, 0.68]) {
			fillPoly(
				c,
				quad(
					iso,
					[x0, wy, fBase],
					[x0, wy + 0.14, fBase],
					[x0, wy + 0.14, fTop],
					[x0, wy, fTop],
				),
				160,
				200,
				235,
			);
		}
	}

	// Purple accent
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		124,
		58,
		237,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		100,
		45,
		200,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Library: orange-accented warm building with book-like window pattern. */
function drawCivicLibrary(c, iso) {
	const OL = [65, 40, 20];
	const x0 = 0.08,
		x1 = 0.92,
		y0 = 0.08,
		y1 = 0.92;
	const wh = 18;

	const pal = {
		wallLight: [225, 200, 170],
		wallDark: [200, 175, 145],
		roofDark: [175, 150, 120],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Large arched entrance
	fillPoly(
		c,
		quad(iso, [0.35, y0, 0], [0.65, y0, 0], [0.65, y0, 13], [0.35, y0, 13]),
		120,
		85,
		55,
	);
	drawLine(c, ...iso(0.35, y0, 0), ...iso(0.35, y0, 13), ...OL);
	drawLine(c, ...iso(0.35, y0, 13), ...iso(0.65, y0, 13), ...OL);
	drawLine(c, ...iso(0.65, y0, 13), ...iso(0.65, y0, 0), ...OL);

	// Tall narrow windows (book-spines motif)
	for (const wx of [0.14, 0.22, 0.74, 0.82]) {
		fillPoly(
			c,
			quad(
				iso,
				[wx, y0, 4],
				[wx + 0.06, y0, 4],
				[wx + 0.06, y0, 14],
				[wx, y0, 14],
			),
			160,
			200,
			230,
		);
		drawLine(c, ...iso(wx, y0, 4), ...iso(wx + 0.06, y0, 4), ...OL);
		drawLine(c, ...iso(wx + 0.06, y0, 4), ...iso(wx + 0.06, y0, 14), ...OL);
		drawLine(c, ...iso(wx + 0.06, y0, 14), ...iso(wx, y0, 14), ...OL);
		drawLine(c, ...iso(wx, y0, 14), ...iso(wx, y0, 4), ...OL);
	}

	// Left wall windows
	for (const wy of [0.2, 0.42, 0.64]) {
		fillPoly(
			c,
			quad(
				iso,
				[x0, wy, 4],
				[x0, wy + 0.14, 4],
				[x0, wy + 0.14, 14],
				[x0, wy, 14],
			),
			160,
			200,
			230,
		);
		drawLine(c, ...iso(x0, wy, 4), ...iso(x0, wy + 0.14, 4), ...OL);
		drawLine(c, ...iso(x0, wy + 0.14, 4), ...iso(x0, wy + 0.14, 14), ...OL);
		drawLine(c, ...iso(x0, wy + 0.14, 14), ...iso(x0, wy, 14), ...OL);
		drawLine(c, ...iso(x0, wy, 14), ...iso(x0, wy, 4), ...OL);
	}

	// Orange accent
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]),
		234,
		88,
		12,
	);
	fillPoly(
		c,
		quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]),
		200,
		72,
		8,
	);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

/** Park: green open space with trees and paths. */
function drawCivicPark(c, iso) {
	const OL = [40, 70, 35];

	// Grass ground (full tile)
	fillPoly(c, [iso(0, 0), iso(1, 0), iso(1, 1), iso(0, 1)], 90, 190, 95);
	drawLine(c, ...iso(0, 0), ...iso(1, 0), 65, 150, 68);
	drawLine(c, ...iso(1, 0), ...iso(1, 1), 65, 150, 68);
	drawLine(c, ...iso(1, 1), ...iso(0, 1), 65, 150, 68);
	drawLine(c, ...iso(0, 1), ...iso(0, 0), 65, 150, 68);

	// Path (diagonal through park)
	fillPoly(
		c,
		quad(iso, [0.42, 0, 0], [0.58, 0, 0], [0.58, 1, 0], [0.42, 1, 0]),
		195,
		185,
		160,
	);
	fillPoly(
		c,
		quad(iso, [0, 0.42, 0], [0, 0.58, 0], [1, 0.58, 0], [1, 0.42, 0]),
		195,
		185,
		160,
	);

	// Trees (simple triangular conifers + trunk)
	function drawTree(tx, ty, th) {
		// Trunk
		fillPoly(
			c,
			quad(
				iso,
				[tx - 0.02, ty, 0],
				[tx + 0.02, ty, 0],
				[tx + 0.02, ty, th * 0.3],
				[tx - 0.02, ty, th * 0.3],
			),
			120,
			80,
			40,
		);
		// Canopy layers (bottom up, largest first)
		for (let layer = 0; layer < 3; layer++) {
			const lBase = th * 0.2 + layer * th * 0.25;
			const lTop = lBase + th * 0.35;
			const spread = 0.1 - layer * 0.02;
			const green = 60 + layer * 25;
			fillPoly(
				c,
				[
					iso(tx - spread, ty, lBase),
					iso(tx + spread, ty, lBase),
					iso(tx, ty, lTop),
				],
				green,
				140 + layer * 15,
				green,
			);
		}
	}

	drawTree(0.2, 0.2, 18);
	drawTree(0.75, 0.25, 15);
	drawTree(0.22, 0.75, 16);
	drawTree(0.78, 0.78, 14);

	// Bench (small detail on path edge)
	fillPoly(
		c,
		quad(iso, [0.6, 0.45, 0], [0.68, 0.45, 0], [0.68, 0.45, 3], [0.6, 0.45, 3]),
		140,
		100,
		55,
	);
	drawLine(c, ...iso(0.6, 0.45, 3), ...iso(0.68, 0.45, 3), 100, 70, 35);
}

/** Stadium: large gray building with tiered seating profile. */
function drawCivicStadium(c, iso) {
	const OL = [55, 58, 62];
	const x0 = 0.05,
		x1 = 0.95,
		y0 = 0.05,
		y1 = 0.95;
	const wh = 22;

	const pal = {
		wallLight: [185, 190, 195],
		wallDark: [155, 160, 168],
		roofDark: [140, 145, 152],
	};
	drawFlatBox(c, iso, x0, y0, x1, y1, wh, pal);

	// Tiered seating lines on walls (horizontal bands)
	for (let tier = 0; tier < 4; tier++) {
		const h = 4 + tier * 5;
		drawLine(c, ...iso(x0, y0, h), ...iso(x1, y0, h), ...OL);
		drawLine(c, ...iso(x0, y0, h), ...iso(x0, y1, h), ...OL);
	}

	// Entrance gates
	for (const wx of [0.15, 0.5]) {
		fillPoly(
			c,
			quad(
				iso,
				[wx, y0, 0],
				[wx + 0.18, y0, 0],
				[wx + 0.18, y0, 10],
				[wx, y0, 10],
			),
			120,
			125,
			130,
		);
		drawLine(c, ...iso(wx, y0, 0), ...iso(wx, y0, 10), ...OL);
		drawLine(c, ...iso(wx, y0, 10), ...iso(wx + 0.18, y0, 10), ...OL);
		drawLine(c, ...iso(wx + 0.18, y0, 10), ...iso(wx + 0.18, y0, 0), ...OL);
	}

	// "Field" green on roof (open-top stadium feel)
	fillPoly(
		c,
		quad(
			iso,
			[x0 + 0.15, y0 + 0.15, wh],
			[x1 - 0.15, y0 + 0.15, wh],
			[x1 - 0.15, y1 - 0.15, wh],
			[x0 + 0.15, y1 - 0.15, wh],
		),
		80,
		170,
		85,
	);
	// Field outline
	drawLine(
		c,
		...iso(x0 + 0.15, y0 + 0.15, wh),
		...iso(x1 - 0.15, y0 + 0.15, wh),
		60,
		140,
		65,
	);
	drawLine(
		c,
		...iso(x1 - 0.15, y0 + 0.15, wh),
		...iso(x1 - 0.15, y1 - 0.15, wh),
		60,
		140,
		65,
	);
	drawLine(
		c,
		...iso(x1 - 0.15, y1 - 0.15, wh),
		...iso(x0 + 0.15, y1 - 0.15, wh),
		60,
		140,
		65,
	);
	drawLine(
		c,
		...iso(x0 + 0.15, y1 - 0.15, wh),
		...iso(x0 + 0.15, y0 + 0.15, wh),
		60,
		140,
		65,
	);

	// Light tower (front-right corner)
	const lx = 0.82,
		ly = 0.15;
	drawLine(c, ...iso(lx, ly, wh), ...iso(lx, ly, wh + 12), 100, 105, 110);
	// Light fixture
	set(c, ...iso(lx - 0.02, ly, wh + 12), 255, 245, 200);
	set(c, ...iso(lx + 0.02, ly, wh + 12), 255, 245, 200);
	set(c, ...iso(lx, ly, wh + 13), 255, 245, 200);

	drawFlatBoxOutlines(c, iso, x0, y0, x1, y1, wh, OL);
}

// ---- Generate all sprites ---------------------------------------------------

const OUTDIR = path.join(__dirname, "..", "public", "sprites");

console.log("Generating building sprites...\n");

const SOLO_SPECS = [
	{ file: "bldg_r1", draw: drawR1, wh: 23 },
	{ file: "bldg_r2", draw: drawR2, wh: 28 },
	{ file: "bldg_r3", draw: drawR3, wh: 50 },
	{ file: "bldg_c1", draw: drawC1, wh: 16 },
	{ file: "bldg_c2", draw: drawC2, wh: 32 },
	{ file: "bldg_c3", draw: drawC3, wh: 58 },
	{ file: "bldg_i1", draw: drawI1, wh: 14 },
	{ file: "bldg_i2", draw: drawI2, wh: 32 },
	{ file: "bldg_i3", draw: drawI3, wh: 38 },
];

for (const spec of SOLO_SPECS) {
	const { w, h } = canvasSize(1, 1, spec.wh);
	const c = createCanvas(w, h);
	const iso = makeIso(w, h, 1, 1);
	spec.draw(c, iso);
	writePng(c, path.join(OUTDIR, spec.file + ".png"));
}

const CLUSTER_SPECS = [
	{ file: "bldg_r2_2x2", zone: "r", tileSize: 2, wh: 30 },
	{ file: "bldg_r3_3x3", zone: "r", tileSize: 3, wh: 55 },
	{ file: "bldg_c2_2x2", zone: "c", tileSize: 2, wh: 36 },
	{ file: "bldg_c3_3x3", zone: "c", tileSize: 3, wh: 85 },
	{ file: "bldg_i2_2x2", zone: "i", tileSize: 2, wh: 22 },
	{ file: "bldg_i3_3x3", zone: "i", tileSize: 3, wh: 35 },
];

for (const spec of CLUSTER_SPECS) {
	const { w, h } = canvasSize(spec.tileSize, spec.tileSize, spec.wh);
	const c = createCanvas(w, h);
	const iso = makeIso(w, h, spec.tileSize, spec.tileSize);
	drawGenericBuilding(c, iso, spec.zone, spec.tileSize, spec.wh);
	writePng(c, path.join(OUTDIR, spec.file + ".png"));
}

const CIVIC_SPECS = [
	{ file: "civic_coal_plant", draw: drawCivicCoalPlant, wh: 38 },
	{ file: "civic_solar_plant", draw: drawCivicSolarPlant, wh: 12 },
	{ file: "civic_water_pump", draw: drawCivicWaterPump, wh: 30 },
	{ file: "civic_police", draw: drawCivicPolice, wh: 18 },
	{ file: "civic_fire_station", draw: drawCivicFireStation, wh: 28 },
	{ file: "civic_hospital", draw: drawCivicHospital, wh: 26 },
	{ file: "civic_school", draw: drawCivicSchool, wh: 30 },
	{ file: "civic_college", draw: drawCivicCollege, wh: 24 },
	{ file: "civic_library", draw: drawCivicLibrary, wh: 18 },
	{ file: "civic_park", draw: drawCivicPark, wh: 18 },
	{ file: "civic_stadium", draw: drawCivicStadium, wh: 34 },
];

console.log("");
for (const spec of CIVIC_SPECS) {
	const { w, h } = canvasSize(1, 1, spec.wh);
	const c = createCanvas(w, h);
	const iso = makeIso(w, h, 1, 1);
	spec.draw(c, iso);
	writePng(c, path.join(OUTDIR, spec.file + ".png"));
}

console.log("\nDone! Generated all building + civic sprites.");
