# landvalue-sim

An open-source, browser-based economic city simulator (RCI demand, land-value
capitalization, agglomeration, externalities, public finance). A deterministic
TypeScript sim core runs in a Web Worker; a Phaser 4 shell renders the city as
isometric tiles; a React + React Aria UI layers over the canvas. See
[`DesignDocs/DESIGN.md`](DesignDocs/DESIGN.md) for the full architecture.

## Prerequisites

- **Node.js 20.19+ or 22.12+** (required by Vite 8)
- npm (ships with Node)

## Install

```bash
npm install
```

## Run the dev server

```bash
npm run dev
```

Then open the URL Vite prints (default <http://localhost:5173>).

> **Cross-origin isolation is required.** The simulation shares state across
> threads via a `SharedArrayBuffer`, which the browser only exposes on
> cross-origin-isolated pages. The dev and preview servers are already
> configured to send the necessary headers
> (`Cross-Origin-Opener-Policy: same-origin` and
> `Cross-Origin-Embedder-Policy: require-corp`) in `vite.config.ts`. If you see
> a "Cannot start simulation" error, the page is not cross-origin isolated —
> serve it over `http://localhost` (not a `file://` URL) so those headers apply.

## Controls

| Action | Input |
| --- | --- |
| Select tool | Sidebar buttons, or `1` R-zone · `2` C-zone · `3` I-zone · `R` road · `X` demolish |
| Deselect tool | `Esc` |
| Apply tool | Left-click / left-drag on the map |
| Pan | Right- or middle-drag, or arrow keys / `WASD` |
| Zoom | Mouse wheel |
| Pause / resume | `Space` |
| Speed | Sidebar speed buttons (pause · 1× · 2× · 3×) |
| Overlays | Sidebar (none · land value · pollution) |

## Other scripts

```bash
npm run build      # type-check then produce a production build in dist/
npm run preview    # serve the production build locally (with the COOP/COEP headers)
npm test           # run the deterministic sim test suite (Vitest)
npm run test:watch # watch mode
npm run lint       # Biome lint + format check
npm run lint:fix   # Biome auto-fix
```

## Deploying

The production build is a static site, but the host **must** send the same two
cross-origin-isolation headers as the dev server:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them the browser disables `SharedArrayBuffer` and the simulation will
not start.

## Project layout

```
src/
  sim/        deterministic, engine-agnostic simulation core (no DOM/Phaser deps)
  worker/     Web Worker that owns the tick loop and writes the shared buffer
  render/     Phaser 4 isometric render shell (reads the shared buffer)
  ui/         React + React Aria interface (sidebar, stats, dev panel)
  app/        main-thread glue: sim client, worker protocol, interaction store
```
