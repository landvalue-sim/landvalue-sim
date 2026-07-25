/**
 * Generate an isometric low-density residential house sprite.
 * Uses the game's 2:1 isometric projection (HALF_W=16, HALF_H=8).
 * Output is 64x80 PNG at 2x resolution — the auto-scaler handles the rest.
 *
 * Usage: node tools/gen-house.cjs [output-path]
 */
const zlib = require("zlib");
const fs = require("fs");

const W = 64;
const H = 80;
const px = Buffer.alloc(W * H * 4, 0);

// ---- Drawing primitives -----------------------------------------------------

function set(x, y, r, g, b, a) {
	x = x | 0;
	y = y | 0;
	if (x >= 0 && x < W && y >= 0 && y < H) {
		const i = (y * W + x) * 4;
		px[i] = r;
		px[i + 1] = g;
		px[i + 2] = b;
		px[i + 3] = a === undefined ? 255 : a;
	}
}

function fillPoly(pts, r, g, b, a) {
	if (a === undefined) a = 255;
	let yMin = H;
	let yMax = 0;
	for (const p of pts) {
		if (p[1] < yMin) yMin = p[1];
		if (p[1] > yMax) yMax = p[1];
	}
	yMin = Math.max(0, Math.floor(yMin));
	yMax = Math.min(H - 1, Math.ceil(yMax));
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
				set(x, y, r, g, b, a);
			}
		}
	}
}

function drawLine(x0, y0, x1, y1, r, g, b, a) {
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
	for (;;) {
		set(x0, y0, r, g, b, a);
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

// ---- Isometric projection ---------------------------------------------------

/** Project tile coords (tx, ty in [0,1], tz = pixel height) to screen. */
function iso(tx, ty, tz) {
	return [32 + (tx - ty) * 31, 79 - (tx + ty) * 15 - (tz || 0)];
}

/** Create screen quad from four 3D points. */
function quad(p1, p2, p3, p4) {
	return [iso(...p1), iso(...p2), iso(...p3), iso(...p4)];
}

// ---- Scene composition ------------------------------------------------------

// Grass yard (full tile diamond)
fillPoly([iso(0, 0), iso(1, 0), iso(1, 1), iso(0, 1)], 76, 175, 80);
// Slightly darker grass edge
drawLine(...iso(0, 0), ...iso(1, 0), 56, 142, 60);
drawLine(...iso(1, 0), ...iso(1, 1), 56, 142, 60);
drawLine(...iso(1, 1), ...iso(0, 1), 56, 142, 60);
drawLine(...iso(0, 1), ...iso(0, 0), 56, 142, 60);

// House footprint (inset from tile edges for yard)
const x0 = 0.18;
const x1 = 0.82;
const y0 = 0.18;
const y1 = 0.82;
const wh = 15; // wall height in px
const rh = 23; // ridge height in px

// Back walls (facing away from camera, fill gaps)
fillPoly(
	quad([x0, y1, 0], [x1, y1, 0], [x1, y1, wh], [x0, y1, wh]),
	160,
	140,
	110,
);
fillPoly(
	quad([x1, y0, 0], [x1, y1, 0], [x1, y1, wh], [x1, y0, wh]),
	175,
	155,
	125,
);

// Ceiling plane (plugs seam between front/back walls)
fillPoly(
	quad([x0, y0, wh], [x1, y0, wh], [x1, y1, wh], [x0, y1, wh]),
	180,
	160,
	130,
);

// Right roof slope (faces away, partially visible at top)
fillPoly(
	quad([x1, y0, wh], [0.5, y0, rh], [0.5, y1, rh], [x1, y1, wh]),
	195,
	85,
	62,
);

// Back gable triangle
fillPoly([iso(x0, y1, wh), iso(x1, y1, wh), iso(0.5, y1, rh)], 210, 188, 152);

// Left roof slope (faces camera, prominent)
fillPoly(
	quad([x0, y0, wh], [0.5, y0, rh], [0.5, y1, rh], [x0, y1, wh]),
	175,
	70,
	50,
);

// Left wall (x=x0 face, darker)
fillPoly(
	quad([x0, y1, 0], [x0, y0, 0], [x0, y0, wh], [x0, y1, wh]),
	195,
	175,
	140,
);

// Right wall (y=y0 face, lighter)
fillPoly(
	quad([x0, y0, 0], [x1, y0, 0], [x1, y0, wh], [x0, y0, wh]),
	220,
	198,
	160,
);

// Front gable triangle
fillPoly([iso(x0, y0, wh), iso(x1, y0, wh), iso(0.5, y0, rh)], 228, 208, 172);

// ---- Details ----------------------------------------------------------------

// Door on right wall (y=y0 face)
fillPoly(
	quad([0.28, y0, 0], [0.42, y0, 0], [0.42, y0, 10], [0.28, y0, 10]),
	115,
	75,
	45,
);
drawLine(...iso(0.28, y0, 0), ...iso(0.28, y0, 10), 55, 40, 30);
drawLine(...iso(0.28, y0, 10), ...iso(0.42, y0, 10), 55, 40, 30);
drawLine(...iso(0.42, y0, 10), ...iso(0.42, y0, 0), 55, 40, 30);
// Door knob
set(...iso(0.39, y0, 5), 200, 180, 80);

// Window on right wall
fillPoly(
	quad([0.56, y0, 6], [0.72, y0, 6], [0.72, y0, 12], [0.56, y0, 12]),
	145,
	200,
	235,
);
drawLine(...iso(0.56, y0, 6), ...iso(0.72, y0, 6), 85, 65, 48);
drawLine(...iso(0.72, y0, 6), ...iso(0.72, y0, 12), 85, 65, 48);
drawLine(...iso(0.72, y0, 12), ...iso(0.56, y0, 12), 85, 65, 48);
drawLine(...iso(0.56, y0, 12), ...iso(0.56, y0, 6), 85, 65, 48);
// Window cross
drawLine(...iso(0.64, y0, 6), ...iso(0.64, y0, 12), 85, 65, 48);
drawLine(...iso(0.56, y0, 9), ...iso(0.72, y0, 9), 85, 65, 48);

// Window on left wall
fillPoly(
	quad([x0, 0.38, 6], [x0, 0.62, 6], [x0, 0.62, 12], [x0, 0.38, 12]),
	145,
	200,
	235,
);
drawLine(...iso(x0, 0.38, 6), ...iso(x0, 0.62, 6), 85, 65, 48);
drawLine(...iso(x0, 0.62, 6), ...iso(x0, 0.62, 12), 85, 65, 48);
drawLine(...iso(x0, 0.62, 12), ...iso(x0, 0.38, 12), 85, 65, 48);
drawLine(...iso(x0, 0.38, 12), ...iso(x0, 0.38, 6), 85, 65, 48);
// Window cross
drawLine(...iso(x0, 0.5, 6), ...iso(x0, 0.5, 12), 85, 65, 48);
drawLine(...iso(x0, 0.38, 9), ...iso(x0, 0.62, 9), 85, 65, 48);

// ---- Building outlines ------------------------------------------------------

const OL = [55, 40, 30];

// Left wall
drawLine(...iso(x0, y1, 0), ...iso(x0, y0, 0), ...OL);
drawLine(...iso(x0, y0, 0), ...iso(x0, y0, wh), ...OL);
drawLine(...iso(x0, y1, 0), ...iso(x0, y1, wh), ...OL);

// Right wall
drawLine(...iso(x0, y0, 0), ...iso(x1, y0, 0), ...OL);
drawLine(...iso(x1, y0, 0), ...iso(x1, y0, wh), ...OL);

// Eave edges
drawLine(...iso(x0, y0, wh), ...iso(x0, y1, wh), ...OL);
drawLine(...iso(x0, y0, wh), ...iso(x1, y0, wh), ...OL);

// Roof edges
drawLine(...iso(x0, y0, wh), ...iso(0.5, y0, rh), ...OL);
drawLine(...iso(x1, y0, wh), ...iso(0.5, y0, rh), ...OL);
drawLine(...iso(0.5, y0, rh), ...iso(0.5, y1, rh), ...OL);
drawLine(...iso(x0, y1, wh), ...iso(0.5, y1, rh), ...OL);
drawLine(...iso(x1, y1, wh), ...iso(0.5, y1, rh), ...OL);

// Back verticals and base
drawLine(...iso(x1, y1, 0), ...iso(x1, y1, wh), ...OL);
drawLine(...iso(x0, y1, 0), ...iso(x1, y1, 0), ...OL);
// Right eave (back side)
drawLine(...iso(x1, y0, wh), ...iso(x1, y1, wh), ...OL);

// ---- Minimal PNG encoder ----------------------------------------------------

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const t = Buffer.from(type);
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
	return Buffer.concat([len, t, data, crc]);
}

// Build filtered scanlines (filter byte 0 = none per row)
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
	raw[y * (1 + W * 4)] = 0;
	px.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const out = Buffer.concat([
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk("IHDR", ihdr),
	pngChunk("IDAT", zlib.deflateSync(raw)),
	pngChunk("IEND", Buffer.alloc(0)),
]);

const outPath = process.argv[2] || "public/sprites/bldg_r1.png";
fs.writeFileSync(outPath, out);
console.log(`Written ${outPath} (${out.length} bytes, ${W}x${H})`);
