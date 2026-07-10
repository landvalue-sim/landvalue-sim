/**
 * Generate all isometric building sprites for the landvalue-sim renderer.
 *
 * Uses the game's 2:1 isometric projection (HALF_W=16, HALF_H=8).
 * Solo (1x1) sprites are 64x80 at 2x resolution.
 * Cluster sprites scale proportionally (2x2 = 128x128, 3x3 = 192x176).
 *
 * Usage: node tools/gen-sprites.cjs
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

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
		// Alpha blend
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
		if (e2 > -dy) { err -= dy; x0 += sx; }
		if (e2 < dx) { err += dx; y0 += sy; }
	}
}

function fillRect(c, x, y, w, h, r, g, b, a) {
	for (let dy = 0; dy < h; dy++) {
		for (let dx = 0; dx < w; dx++) {
			set(c, x + dx, y + dy, r, g, b, a);
		}
	}
}

// ---- Isometric helpers ------------------------------------------------------

function makeIso(canvasW, canvasH, tileW, tileH) {
	// Map tile coords (tx in [0..tileW], ty in [0..tileH]) to screen pixels.
	// The footprint diamond fills the canvas width; bottom-center aligned.
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
		// Residential: warm cream/brown walls, red/terracotta roof
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
		// Commercial: blue-gray glass, steel frame
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
		// Industrial: dull tan/gray, rust accents
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

/**
 * R1: Small house with pitched roof, door, windows, yard.
 */
function drawR1(c, iso) {
	const p = PALETTES.r;
	const OL = p.outline;

	// Grass yard
	fillPoly(c, [iso(0, 0), iso(1, 0), iso(1, 1), iso(0, 1)], 76, 175, 80);
	drawLine(c, ...iso(0, 0), ...iso(1, 0), 56, 142, 60);
	drawLine(c, ...iso(1, 0), ...iso(1, 1), 56, 142, 60);
	drawLine(c, ...iso(1, 1), ...iso(0, 1), 56, 142, 60);
	drawLine(c, ...iso(0, 1), ...iso(0, 0), 56, 142, 60);

	const x0 = 0.18, x1 = 0.82, y0 = 0.18, y1 = 0.82;
	const wh = 15, rh = 23;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Ceiling
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.gable);
	// Right roof slope
	fillPoly(c, quad(iso, [x1, y0, wh], [0.5, y0, rh], [0.5, y1, rh], [x1, y1, wh]), ...p.roofLight);
	// Back gable
	fillPoly(c, [iso(x0, y1, wh), iso(x1, y1, wh), iso(0.5, y1, rh)], ...p.gable);
	// Left roof slope
	fillPoly(c, quad(iso, [x0, y0, wh], [0.5, y0, rh], [0.5, y1, rh], [x0, y1, wh]), ...p.roofDark);
	// Left wall
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	// Right wall
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);
	// Front gable
	fillPoly(c, [iso(x0, y0, wh), iso(x1, y0, wh), iso(0.5, y0, rh)], ...p.gable);

	// Door
	fillPoly(c, quad(iso, [0.28, y0, 0], [0.42, y0, 0], [0.42, y0, 10], [0.28, y0, 10]), ...p.door);
	drawLine(c, ...iso(0.28, y0, 0), ...iso(0.28, y0, 10), ...OL);
	drawLine(c, ...iso(0.28, y0, 10), ...iso(0.42, y0, 10), ...OL);
	drawLine(c, ...iso(0.42, y0, 10), ...iso(0.42, y0, 0), ...OL);
	set(c, ...iso(0.39, y0, 5), 200, 180, 80);

	// Window right wall
	fillPoly(c, quad(iso, [0.56, y0, 6], [0.72, y0, 6], [0.72, y0, 12], [0.56, y0, 12]), ...p.window);
	drawLine(c, ...iso(0.56, y0, 6), ...iso(0.72, y0, 6), ...OL);
	drawLine(c, ...iso(0.72, y0, 6), ...iso(0.72, y0, 12), ...OL);
	drawLine(c, ...iso(0.72, y0, 12), ...iso(0.56, y0, 12), ...OL);
	drawLine(c, ...iso(0.56, y0, 12), ...iso(0.56, y0, 6), ...OL);
	drawLine(c, ...iso(0.64, y0, 6), ...iso(0.64, y0, 12), ...OL);
	drawLine(c, ...iso(0.56, y0, 9), ...iso(0.72, y0, 9), ...OL);

	// Window left wall
	fillPoly(c, quad(iso, [x0, 0.38, 6], [x0, 0.62, 6], [x0, 0.62, 12], [x0, 0.38, 12]), ...p.window);
	drawLine(c, ...iso(x0, 0.38, 6), ...iso(x0, 0.62, 6), ...OL);
	drawLine(c, ...iso(x0, 0.62, 6), ...iso(x0, 0.62, 12), ...OL);
	drawLine(c, ...iso(x0, 0.62, 12), ...iso(x0, 0.38, 12), ...OL);
	drawLine(c, ...iso(x0, 0.38, 12), ...iso(x0, 0.38, 6), ...OL);
	drawLine(c, ...iso(x0, 0.5, 6), ...iso(x0, 0.5, 12), ...OL);
	drawLine(c, ...iso(x0, 0.38, 9), ...iso(x0, 0.62, 9), ...OL);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(0.5, y0, rh), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(0.5, y0, rh), ...OL);
	drawLine(c, ...iso(0.5, y0, rh), ...iso(0.5, y1, rh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(0.5, y1, rh), ...OL);
	drawLine(c, ...iso(x1, y1, wh), ...iso(0.5, y1, rh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * R2: Mid-density apartment block — flat roof, multiple window rows.
 */
function drawR2(c, iso) {
	const p = PALETTES.r;
	const OL = p.outline;
	const x0 = 0.08, x1 = 0.92, y0 = 0.08, y1 = 0.92;
	const wh = 28;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Flat roof
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofDark);
	// Front walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Door
	fillPoly(c, quad(iso, [0.38, y0, 0], [0.62, y0, 0], [0.62, y0, 12], [0.38, y0, 12]), ...p.door);
	drawLine(c, ...iso(0.38, y0, 0), ...iso(0.38, y0, 12), ...OL);
	drawLine(c, ...iso(0.38, y0, 12), ...iso(0.62, y0, 12), ...OL);
	drawLine(c, ...iso(0.62, y0, 12), ...iso(0.62, y0, 0), ...OL);

	// Window rows (3 floors)
	for (let floor = 0; floor < 3; floor++) {
		const fBase = 4 + floor * 8;
		const fTop = fBase + 5;
		// Right wall windows
		for (const wx of [0.2, 0.5, 0.75]) {
			const wx2 = wx + 0.12;
			if (floor === 0 && wx >= 0.35 && wx <= 0.65) continue; // skip door area
			fillPoly(c, quad(iso, [wx, y0, fBase], [wx2, y0, fBase], [wx2, y0, fTop], [wx, y0, fTop]), ...p.window);
			drawLine(c, ...iso(wx, y0, fBase), ...iso(wx2, y0, fBase), ...OL);
			drawLine(c, ...iso(wx2, y0, fBase), ...iso(wx2, y0, fTop), ...OL);
			drawLine(c, ...iso(wx2, y0, fTop), ...iso(wx, y0, fTop), ...OL);
			drawLine(c, ...iso(wx, y0, fTop), ...iso(wx, y0, fBase), ...OL);
		}
		// Left wall windows
		for (const wy of [0.2, 0.5, 0.75]) {
			const wy2 = wy + 0.12;
			fillPoly(c, quad(iso, [x0, wy, fBase], [x0, wy2, fBase], [x0, wy2, fTop], [x0, wy, fTop]), ...p.window);
			drawLine(c, ...iso(x0, wy, fBase), ...iso(x0, wy2, fBase), ...OL);
			drawLine(c, ...iso(x0, wy2, fBase), ...iso(x0, wy2, fTop), ...OL);
			drawLine(c, ...iso(x0, wy2, fTop), ...iso(x0, wy, fTop), ...OL);
			drawLine(c, ...iso(x0, wy, fTop), ...iso(x0, wy, fBase), ...OL);
		}
	}

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * R3: High-density tower — tall, narrow, many windows.
 */
function drawR3(c, iso) {
	const p = PALETTES.r;
	const OL = p.outline;
	const x0 = 0.12, x1 = 0.88, y0 = 0.12, y1 = 0.88;
	const wh = 50;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Flat roof
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofDark);
	// Front walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Door
	fillPoly(c, quad(iso, [0.35, y0, 0], [0.65, y0, 0], [0.65, y0, 12], [0.35, y0, 12]), ...p.door);

	// Many window rows (6 floors)
	for (let floor = 0; floor < 6; floor++) {
		const fBase = 4 + floor * 7;
		const fTop = fBase + 4;
		if (floor === 0) continue; // door floor
		// Right wall
		for (const wx of [0.2, 0.45, 0.7]) {
			const wx2 = wx + 0.12;
			fillPoly(c, quad(iso, [wx, y0, fBase], [wx2, y0, fBase], [wx2, y0, fTop], [wx, y0, fTop]), ...p.window);
			drawLine(c, ...iso(wx, y0, fBase), ...iso(wx2, y0, fTop), ...OL);
		}
		// Left wall
		for (const wy of [0.2, 0.45, 0.7]) {
			const wy2 = wy + 0.12;
			fillPoly(c, quad(iso, [x0, wy, fBase], [x0, wy2, fBase], [x0, wy2, fTop], [x0, wy, fTop]), ...p.window);
			drawLine(c, ...iso(x0, wy, fBase), ...iso(x0, wy2, fTop), ...OL);
		}
	}

	// Roof accent (red band at top)
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]), ...p.accent);
	fillPoly(c, quad(iso, [x0, y1, wh - 2], [x0, y0, wh - 2], [x0, y0, wh], [x0, y1, wh]), ...p.accent);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * C1: Small shop — awning over front, display window.
 */
function drawC1(c, iso) {
	const p = PALETTES.c;
	const OL = p.outline;
	const x0 = 0.1, x1 = 0.9, y0 = 0.1, y1 = 0.9;
	const wh = 14;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Flat roof
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofLight);
	// Front walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Large display window (right wall)
	fillPoly(c, quad(iso, [0.18, y0, 2], [0.82, y0, 2], [0.82, y0, 10], [0.18, y0, 10]), ...p.window);
	drawLine(c, ...iso(0.18, y0, 2), ...iso(0.82, y0, 2), ...OL);
	drawLine(c, ...iso(0.82, y0, 2), ...iso(0.82, y0, 10), ...OL);
	drawLine(c, ...iso(0.82, y0, 10), ...iso(0.18, y0, 10), ...OL);
	drawLine(c, ...iso(0.18, y0, 10), ...iso(0.18, y0, 2), ...OL);
	// Door in window
	fillPoly(c, quad(iso, [0.42, y0, 0], [0.58, y0, 0], [0.58, y0, 10], [0.42, y0, 10]), ...p.door);
	drawLine(c, ...iso(0.42, y0, 0), ...iso(0.42, y0, 10), ...OL);
	drawLine(c, ...iso(0.58, y0, 0), ...iso(0.58, y0, 10), ...OL);

	// Left wall window
	fillPoly(c, quad(iso, [x0, 0.25, 2], [x0, 0.75, 2], [x0, 0.75, 10], [x0, 0.25, 10]), ...p.window);
	drawLine(c, ...iso(x0, 0.25, 2), ...iso(x0, 0.75, 2), ...OL);
	drawLine(c, ...iso(x0, 0.75, 2), ...iso(x0, 0.75, 10), ...OL);
	drawLine(c, ...iso(x0, 0.75, 10), ...iso(x0, 0.25, 10), ...OL);
	drawLine(c, ...iso(x0, 0.25, 10), ...iso(x0, 0.25, 2), ...OL);

	// Awning (extends forward from the roof over the front wall)
	fillPoly(c, quad(iso, [x0 - 0.06, y0 - 0.06, wh - 2], [x1 + 0.06, y0 - 0.06, wh - 2], [x1, y0, wh], [x0, y0, wh]), ...p.accent);

	// Blue accent stripe
	fillPoly(c, quad(iso, [x0, y0, wh - 1], [x1, y0, wh - 1], [x1, y0, wh], [x0, y0, wh]), ...p.accent);
	fillPoly(c, quad(iso, [x0, y0, wh - 1], [x0, y1, wh - 1], [x0, y1, wh], [x0, y0, wh]), ...p.accent);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * C2: Office building — glass curtain wall, bands of windows.
 */
function drawC2(c, iso) {
	const p = PALETTES.c;
	const OL = p.outline;
	const x0 = 0.05, x1 = 0.95, y0 = 0.05, y1 = 0.95;
	const wh = 32;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Roof
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofDark);
	// Front walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Horizontal window bands (curtain wall look)
	for (let floor = 0; floor < 4; floor++) {
		const fBase = 3 + floor * 7;
		const fTop = fBase + 4;
		// Right wall — full width glass band
		fillPoly(c, quad(iso, [x0 + 0.04, y0, fBase], [x1 - 0.04, y0, fBase], [x1 - 0.04, y0, fTop], [x0 + 0.04, y0, fTop]), ...p.window);
		// Left wall — full width glass band
		fillPoly(c, quad(iso, [x0, y0 + 0.04, fBase], [x0, y1 - 0.04, fBase], [x0, y1 - 0.04, fTop], [x0, y0 + 0.04, fTop]), ...p.window);
		// Spandrel line
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x1, y0, fBase), ...OL);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x0, y1, fBase), ...OL);
	}

	// Door
	fillPoly(c, quad(iso, [0.4, y0, 0], [0.6, y0, 0], [0.6, y0, 9], [0.4, y0, 9]), ...p.door);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * C3: Skyscraper — tall glass tower with setback.
 */
function drawC3(c, iso) {
	const p = PALETTES.c;
	const OL = p.outline;
	const x0 = 0.1, x1 = 0.9, y0 = 0.1, y1 = 0.9;
	const wh = 58;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Roof
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofDark);
	// Front walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Window bands (8 floors)
	for (let floor = 0; floor < 8; floor++) {
		const fBase = 3 + floor * 6.5;
		const fTop = fBase + 4;
		fillPoly(c, quad(iso, [x0 + 0.03, y0, fBase], [x1 - 0.03, y0, fBase], [x1 - 0.03, y0, fTop], [x0 + 0.03, y0, fTop]), ...p.window);
		fillPoly(c, quad(iso, [x0, y0 + 0.03, fBase], [x0, y1 - 0.03, fBase], [x0, y1 - 0.03, fTop], [x0, y0 + 0.03, fTop]), ...p.window);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x1, y0, fBase), ...OL);
		drawLine(c, ...iso(x0, y0, fBase), ...iso(x0, y1, fBase), ...OL);
	}

	// Entrance
	fillPoly(c, quad(iso, [0.35, y0, 0], [0.65, y0, 0], [0.65, y0, 10], [0.35, y0, 10]), ...p.window);
	drawLine(c, ...iso(0.5, y0, 0), ...iso(0.5, y0, 10), ...OL);

	// Crown accent
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]), ...p.accent);
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]), ...p.accent);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * I1: Small warehouse/shed — corrugated look, loading door.
 */
function drawI1(c, iso) {
	const p = PALETTES.i;
	const OL = p.outline;
	const x0 = 0.1, x1 = 0.9, y0 = 0.1, y1 = 0.9;
	const wh = 12;

	// Back walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	// Roof (slightly sloped — front higher)
	fillPoly(c, quad(iso, [x0, y0, wh + 2], [x1, y0, wh + 2], [x1, y1, wh], [x0, y1, wh]), ...p.roofLight);
	// Front walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh + 2], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh + 2], [x0, y0, wh + 2]), ...p.wallLight);

	// Loading door (large roll-up)
	fillPoly(c, quad(iso, [0.2, y0, 0], [0.7, y0, 0], [0.7, y0, 10], [0.2, y0, 10]), ...p.door);
	// Horizontal lines on door (roll-up segments)
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

	// Rust accent stripe
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y0, wh + 2], [x0, y0, wh + 2]), ...p.accent);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh + 2), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh + 2), ...OL);
	drawLine(c, ...iso(x0, y0, wh + 2), ...iso(x1, y0, wh + 2), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x0, y0, wh + 2), ...OL);
	drawLine(c, ...iso(x1, y1, wh), ...iso(x1, y0, wh + 2), ...OL);
}

/**
 * I2: Medium factory — smokestack, larger footprint feel.
 */
function drawI2(c, iso) {
	const p = PALETTES.i;
	const OL = p.outline;
	const x0 = 0.05, x1 = 0.95, y0 = 0.05, y1 = 0.95;
	const wh = 18;

	// Main building
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofLight);
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Smokestack
	const sx0 = 0.7, sx1 = 0.85, sy0 = 0.6, sy1 = 0.75;
	const sh = 32;
	fillPoly(c, quad(iso, [sx0, sy1, wh], [sx1, sy1, wh], [sx1, sy1, sh], [sx0, sy1, sh]), ...p.wallDark);
	fillPoly(c, quad(iso, [sx1, sy0, wh], [sx1, sy1, wh], [sx1, sy1, sh], [sx1, sy0, sh]), ...p.wallLight);
	fillPoly(c, quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]), 80, 75, 65);
	// Stack outline
	drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL);
	drawLine(c, ...iso(sx1, sy1, wh), ...iso(sx1, sy1, sh), ...OL);
	drawLine(c, ...iso(sx0, sy0, wh), ...iso(sx0, sy0, sh), ...OL);
	drawLine(c, ...iso(sx1, sy0, wh), ...iso(sx1, sy0, sh), ...OL);
	drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL);
	drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL);
	drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL);
	drawLine(c, ...iso(sx0, sy1, sh), ...iso(sx1, sy1, sh), ...OL);

	// Loading doors
	fillPoly(c, quad(iso, [0.1, y0, 0], [0.4, y0, 0], [0.4, y0, 12], [0.1, y0, 12]), ...p.door);
	fillPoly(c, quad(iso, [0.55, y0, 0], [0.85, y0, 0], [0.85, y0, 12], [0.55, y0, 12]), ...p.door);
	for (let s = 3; s < 12; s += 3) {
		drawLine(c, ...iso(0.1, y0, s), ...iso(0.4, y0, s), ...OL);
		drawLine(c, ...iso(0.55, y0, s), ...iso(0.85, y0, s), ...OL);
	}

	// Windows on left wall
	for (const wy of [0.2, 0.5, 0.75]) {
		fillPoly(c, quad(iso, [x0, wy, 8], [x0, wy + 0.1, 8], [x0, wy + 0.1, 14], [x0, wy, 14]), ...p.window);
	}

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

/**
 * I3: Heavy industry — large plant with silos.
 */
function drawI3(c, iso) {
	const p = PALETTES.i;
	const OL = p.outline;
	const x0 = 0.05, x1 = 0.95, y0 = 0.05, y1 = 0.95;
	const wh = 24;

	// Main building
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofLight);
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Two smokestacks
	for (const [sx0, sy0] of [[0.65, 0.55], [0.75, 0.7]]) {
		const sx1 = sx0 + 0.12;
		const sy1 = sy0 + 0.12;
		const sh = sx0 < 0.7 ? 38 : 34;
		fillPoly(c, quad(iso, [sx0, sy1, wh], [sx1, sy1, wh], [sx1, sy1, sh], [sx0, sy1, sh]), ...p.wallDark);
		fillPoly(c, quad(iso, [sx1, sy0, wh], [sx1, sy1, wh], [sx1, sy1, sh], [sx1, sy0, sh]), ...p.wallLight);
		fillPoly(c, quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]), 80, 75, 65);
		drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL);
		drawLine(c, ...iso(sx1, sy1, wh), ...iso(sx1, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL);
		drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL);
	}

	// Loading doors and windows
	fillPoly(c, quad(iso, [0.1, y0, 0], [0.45, y0, 0], [0.45, y0, 14], [0.1, y0, 14]), ...p.door);
	for (let s = 3; s < 14; s += 3) {
		drawLine(c, ...iso(0.1, y0, s), ...iso(0.45, y0, s), ...OL);
	}

	// Rust accent band
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]), ...p.accent);
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]), ...p.accent);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

// ---- Generic building for cluster sprites -----------------------------------

/**
 * Draw a generic multi-tile building. Used for cluster (2x2, 3x3) sprites.
 * The building fills most of the footprint with zone-appropriate details.
 */
function drawGenericBuilding(c, iso, zone, tileSize, wallHeight) {
	const p = PALETTES[zone];
	const OL = p.outline;
	const margin = 0.04 * tileSize;
	const x0 = margin, x1 = tileSize - margin;
	const y0 = margin, y1 = tileSize - margin;
	const wh = wallHeight;

	// Walls
	fillPoly(c, quad(iso, [x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]), ...p.wallLight);
	fillPoly(c, quad(iso, [x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]), ...p.roofDark);
	fillPoly(c, quad(iso, [x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]), ...p.wallDark);
	fillPoly(c, quad(iso, [x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]), ...p.wallLight);

	// Window rows
	const numFloors = Math.floor(wh / 7);
	const wallLen = x1 - x0;
	const numWindowsPerWall = Math.max(2, Math.floor(wallLen / 0.25));
	const winSpacing = wallLen / (numWindowsPerWall + 1);
	const winW = winSpacing * 0.6;

	for (let floor = 0; floor < numFloors; floor++) {
		const fBase = 3 + floor * 7;
		const fTop = fBase + 4;
		if (floor === 0 && zone !== "c") continue; // door floor for R/I

		// Right wall windows
		for (let w = 0; w < numWindowsPerWall; w++) {
			const wx = x0 + winSpacing * (w + 1) - winW / 2;
			fillPoly(c, quad(iso, [wx, y0, fBase], [wx + winW, y0, fBase], [wx + winW, y0, fTop], [wx, y0, fTop]), ...p.window);
		}
		// Left wall windows
		for (let w = 0; w < numWindowsPerWall; w++) {
			const wy = y0 + winSpacing * (w + 1) - winW / 2;
			fillPoly(c, quad(iso, [x0, wy, fBase], [x0, wy + winW, fBase], [x0, wy + winW, fTop], [x0, wy, fTop]), ...p.window);
		}
	}

	// Door/entrance
	const doorW = wallLen * 0.15;
	const mid = (x0 + x1) / 2;
	fillPoly(c, quad(iso, [mid - doorW, y0, 0], [mid + doorW, y0, 0], [mid + doorW, y0, 10], [mid - doorW, y0, 10]), ...p.door);

	// Zone-specific details
	if (zone === "i" && tileSize >= 2) {
		// Smokestack for industrial
		const sx0 = x1 - 0.25, sx1 = x1 - 0.12;
		const sy0 = y1 - 0.35, sy1 = y1 - 0.22;
		const sh = wh + 16;
		fillPoly(c, quad(iso, [sx0, sy1, wh], [sx1, sy1, wh], [sx1, sy1, sh], [sx0, sy1, sh]), ...p.wallDark);
		fillPoly(c, quad(iso, [sx1, sy0, wh], [sx1, sy1, wh], [sx1, sy1, sh], [sx1, sy0, sh]), ...p.wallLight);
		fillPoly(c, quad(iso, [sx0, sy0, sh], [sx1, sy0, sh], [sx1, sy1, sh], [sx0, sy1, sh]), 80, 75, 65);
		drawLine(c, ...iso(sx0, sy1, wh), ...iso(sx0, sy1, sh), ...OL);
		drawLine(c, ...iso(sx1, sy1, wh), ...iso(sx1, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx1, sy0, sh), ...OL);
		drawLine(c, ...iso(sx1, sy0, sh), ...iso(sx1, sy1, sh), ...OL);
		drawLine(c, ...iso(sx0, sy0, sh), ...iso(sx0, sy1, sh), ...OL);
	}

	if (zone === "r" && tileSize >= 3) {
		// Pitched roof section for large residential
		const rx0 = x0 + wallLen * 0.1, rx1 = x1 - wallLen * 0.1;
		const ridgeH = wh + 8;
		fillPoly(c, quad(iso, [rx0, y0, wh], [(rx0 + rx1) / 2, y0, ridgeH], [(rx0 + rx1) / 2, y1, ridgeH], [rx0, y1, wh]), ...p.roofDark);
		fillPoly(c, quad(iso, [rx1, y0, wh], [(rx0 + rx1) / 2, y0, ridgeH], [(rx0 + rx1) / 2, y1, ridgeH], [rx1, y1, wh]), ...p.roofLight);
		drawLine(c, ...iso((rx0 + rx1) / 2, y0, ridgeH), ...iso((rx0 + rx1) / 2, y1, ridgeH), ...OL);
	}

	// Accent band at top
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x1, y0, wh - 2], [x1, y0, wh], [x0, y0, wh]), ...p.accent);
	fillPoly(c, quad(iso, [x0, y0, wh - 2], [x0, y1, wh - 2], [x0, y1, wh], [x0, y0, wh]), ...p.accent);

	// Outlines
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
	drawLine(c, ...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);
	drawLine(c, ...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
	drawLine(c, ...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);
	drawLine(c, ...iso(x0, y1, wh), ...iso(x1, y1, wh), ...OL);
}

// ---- Canvas size calculator -------------------------------------------------

function canvasSize(tileW, tileH, wallHeight) {
	// Width = footprint diamond width at 2x (HALF_W=16, so 2x = 32 per tile unit)
	// Use exact multiple so auto-scale = footprintPx / textureWidth = 0.5
	const w = (tileW + tileH) * 32;
	// Height = footprint diamond height + wall height + 1 for rounding
	const baseH = (tileW + tileH) * 16;
	const h = baseH + wallHeight;
	return { w, h };
}

// ---- Generate all sprites ---------------------------------------------------

const OUTDIR = path.join(__dirname, "..", "public", "sprites");

console.log("Generating building sprites...\n");

// Solo 1x1 sprites
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

// Cluster sprites
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

console.log("\nDone! Generated all 15 building sprites.");
