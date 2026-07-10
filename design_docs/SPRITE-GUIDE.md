# Sprite Art Guide

> **Status: Tentative** — this pipeline may change as we iterate on the
> AI-generation workflow.

How to add building sprites to landvalue-sim. Drop PNG files into
`public/sprites/` and the renderer picks them up automatically — no code
changes needed. Images are auto-scaled to fit the tile grid, so any
resolution works (including direct Nano Banana 2 output).

## Quick Start

1. Generate or create a transparent PNG of an isometric building.
2. Name it according to the convention (e.g. `bldg_r1.png`).
3. Place it in `public/sprites/`.
4. Run the game — your sprite replaces the procedural placeholder.

## How Auto-Scaling Works

The renderer measures the loaded image's pixel width and scales it to match
the tile footprint:

```
scale = footprintWidthPx / imageWidth
```

Where `footprintWidthPx = (tileW + tileH) * 16`. For a 1x1 tile that's
32px, for 2x2 it's 64px, for 3x3 it's 96px.

This means you can use **any resolution** — a 128px wide image, a 512px
wide image, or a 1024px wide image all work for a 1x1 sprite. Higher
resolution = more detail when zoomed in.

## Generating with Nano Banana 2

Use the fal.ai flow interface with these settings:

- **Aspect ratio**: Use a ratio taller than wide (e.g. `3:4` or `2:3`) since
  buildings are taller than the diamond base. For squat structures like
  houses or factories, `1:1` works.
- **Resolution**: `1K` is fine for solo sprites; `2K` for cluster sprites.
- **Format**: PNG (default) — needs transparency for the diamond cutout.
- **Prompt tips**: Include "isometric building", "transparent background",
  "2:1 isometric projection", "game sprite", "single building isolated".

After generation, trim excess transparent space if needed, but the auto-scale
handles oversized images gracefully.

## Coordinate System

The game uses a standard isometric (2:1) diamond projection.

```
        N
       / \
      /   \       1x1 tile diamond: 32px wide x 16px tall
     W     E      HALF_W = 16, HALF_H = 8
      \   /
       \ /
        S
```

## Origin & Alignment

The sprite origin is **bottom-center (0.5, 1.0)**:

- The **bottom-center pixel** of your image aligns with the **south corner**
  (S) of the footprint diamond.
- The building rises **upward** from the diamond base.

```
  ┌─────────────────────┐
  │                     │  ← Building wall area
  │      ___roof___     │
  │     /          \    │
  │    /   roof     \   │
  │  /________________\ │
  │  \                / │
  │   \   diamond    /  │  ← Diamond base area
  │    \   base     /   │
  │     \          /    │
  │      \________/     │
  └──────────┼──────────┘
             S (origin: bottom-center)
```

The image should have the isometric diamond base at the bottom, with the
building extending upward. Transparent corners outside the diamond/building
silhouette.

## Sprite Table

### Solo Sprites (1x1 footprint)

Used for isolated buildings or as fallbacks when tiles don't form a cluster.

| File           | Zone        | Density | Description              |
|----------------|-------------|---------|--------------------------|
| `bldg_r1.png`  | Residential | Low     | Small house              |
| `bldg_r2.png`  | Residential | Medium  | Apartment building       |
| `bldg_r3.png`  | Residential | High    | Residential tower        |
| `bldg_c1.png`  | Commercial  | Low     | Small shop               |
| `bldg_c2.png`  | Commercial  | Medium  | Office building          |
| `bldg_c3.png`  | Commercial  | High    | Skyscraper               |
| `bldg_i1.png`  | Industrial  | Low     | Small workshop           |
| `bldg_i2.png`  | Industrial  | Medium  | Factory                  |
| `bldg_i3.png`  | Industrial  | High    | Industrial complex       |

### Cluster Sprites (multi-tile footprint)

Used when adjacent tiles of the same zone and density form a complete NxN
block. Density 2 clusters are 2x2 tiles, density 3 clusters are 3x3 tiles.

| File                | Zone        | Density | Footprint | Description           |
|---------------------|-------------|---------|-----------|-----------------------|
| `bldg_r2_2x2.png`  | Residential | Medium  | 2x2       | Apartment complex     |
| `bldg_r3_3x3.png`  | Residential | High    | 3x3       | High-rise complex     |
| `bldg_c2_2x2.png`  | Commercial  | Medium  | 2x2       | Shopping center       |
| `bldg_c3_3x3.png`  | Commercial  | High    | 3x3       | Skyscraper plaza      |
| `bldg_i2_2x2.png`  | Industrial  | Medium  | 2x2       | Factory complex       |
| `bldg_i3_3x3.png`  | Industrial  | High    | 3x3       | Industrial park       |

## Image Proportions Guide

Since auto-scaling matches image width to the tile diamond width, the
**aspect ratio** of your image determines how tall the building appears.
Some guidelines:

| Building Type         | Suggested Aspect Ratio | Why                          |
|-----------------------|------------------------|------------------------------|
| House (r1)            | ~1:1                   | Short and wide               |
| Apartment (r2)        | ~3:4                   | Moderately tall              |
| Skyscraper (c3)       | ~1:2                   | Tall and narrow              |
| Factory (i1, i2)      | ~4:3                   | Wide and squat               |
| Industrial park (i3)  | ~1:1                   | Spread out                   |

## Drawing Tips

### Isometric Walls

Buildings have two visible wall faces in isometric view:

- **Left wall** (W to S edge) — darker shade (shadow side)
- **Right wall** (S to E edge) — medium shade
- **Roof** (top diamond) — brightest shade

Use consistent light direction (light from top-right) across all sprites.

### Multi-Tile Sprites

For 2x2 and 3x3 sprites, the diamond base is larger. The building should
fill the larger footprint as one big structure, not tiled copies.

### Transparency

Use transparent PNG. The diamond base area has transparent corners (the
triangular regions outside the diamond). Make sure the building silhouette
doesn't extend beyond the image bounds.

## File Naming Convention

```
bldg_{zone}{density}[_{w}x{h}].png

zone:     r = residential, c = commercial, i = industrial
density:  1 = low, 2 = medium, 3 = high
_{w}x{h}: only for cluster sprites (e.g. _2x2, _3x3)
```

## Testing

Run the dev server (`npm run dev`) and zone some tiles. Your sprites appear
in place of the colored procedural boxes. If a sprite is missing or fails to
load, the procedural placeholder stays — nothing breaks.

To verify alignment, check that the building's bottom diamond aligns with
the terrain tile edges and the building doesn't float or sink into the ground.
