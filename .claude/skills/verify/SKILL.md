# Verify — landvalue-sim

Runtime verification recipe for this repo (browser Phaser app).

## Launch

```bash
npm run dev   # Vite; port 5173 may be taken by the user's own server — watch stdout for the actual port
```

Open the printed URL in a claude-in-chrome tab.

## Gotchas (hard-won)

- The MCP tab is usually **background/occluded**: `document.hidden` is true,
  rAF never fires, and Phaser's game loop is paused. `setTimeout` is throttled
  too (long scripts hit the 45s CDP timeout).
- **Each CDP screenshot forces exactly one rAF** — use screenshots (or the
  cheaper `zoom` region capture) to step the game loop deterministically:
  dispatch input → screenshot → assert.
- Synthetic input must be **MouseEvent / WheelEvent** dispatched on the canvas.
  Phaser 4's MouseManager listens for `mouse*` — synthetic `PointerEvent`s are
  ignored. Right-drag pan: `mousedown` with `buttons: 2, button: 2`, then
  `mousemove` with `buttons: 2`. Wheel zoom: `WheelEvent` with `deltaY`.
- The extension's `key` action doesn't drive Phaser's polled keyboard
  (`key.isDown`) — the loop isn't running between keydown/keyup.
- To instrument render internals, import Vite's own Phaser bundle to get the
  same module instance, then patch prototypes:
  `performance.getEntriesByType('resource')` → find `deps/phaser.js?v=...` →
  `(await import(url)).default`. E.g. wrap
  `Phaser.Textures.DynamicTexture.prototype.render` to count/time world bakes
  (the iso-scene calls it once per bake).
- For **realistic frame cadence** (testing time-based logic like bake
  throttling), grab the game instance inside a patched render call
  (`this.manager.game`), then drive the loop manually:
  `game.loop.step(t += 16)` with controlled timestamps. The scene is
  reachable via `game.scene.getScene('iso')` — private TS fields (rt,
  cameras) are readable at runtime for invariant checks.

## Useful flows

- Pause the sim (speed `⏸` button, or it starts paused on a fresh city) to
  isolate camera-driven redraws from tick-driven ones.
- Pan: right-button drag on the canvas. Zoom: wheel. Bake policy lives in
  `src/render/iso-scene.ts` (`bakeDirty`/`bakeWorld`).
