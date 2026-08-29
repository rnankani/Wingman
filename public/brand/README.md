# Wingman brand assets

## Chikny

The mascot is **Chikny**, a Codex pet: a round chick-like fantasy hatchling with
glossy eyes, tufted feathers, stubby wings, and a soft yellow-orange palette.
Source: `chikny-codex-pet.zip` (`spritesheet.webp` + `pet.json`).

**Provenance matters here.** This art was downloaded as a Codex pet, not drawn
for this project. Before making the repo public, confirm the licence permits
redistribution and use as a project logo — a hackathon repo is publication. If
it doesn't, everything still works: `src/brand.ts` is the only file that knows
about the sheet, so swapping in original art means replacing `chikny.webp` and
adjusting the grid constants.

## The sheet

`chikny.webp` — 1536x1872, an 8x9 grid of **192x208** frames. One row per
animation state, and the rows are **ragged**:

| row | frames | used as |
|----:|-------:|---------|
| 0 | 6 | `idle` |
| 1 | 8 | `negotiating` |
| 2 | 8 | — |
| 3 | 4 | `greeting` |
| 4 | 5 | — |
| 5 | 8 | `passed` |
| 6 | 6 | `resting` |
| 7 | 6 | `learning` |
| 8 | 6 | `logo` (c2), `thinking` (c1), `matched` (c4) |

Animating a row as if it had 8 frames when it has 6 plays two blank cells, so
`POSES[name].frames` is the real count and the generated CSS uses it.

## Rules

- **`--chikny-scale` must land the frame on whole pixels.** 192 and 208 times
  the scale both have to be integers. `0.5`, `1`, `1.5`, `2` are safe; `1.15` is
  not (208 x 1.15 = 239.2) and the neighbouring frame bleeds in along the seam.
- **Prefer integer scales for large renders.** At `1.5` each source pixel becomes
  1.5 device pixels, so `image-rendering: pixelated` duplicates some rows and not
  others. It is not a bug, but `1` and `2` stay perfectly crisp.
- **`src/brand.ts` is the source of truth.** `/brand/wingman.css` is generated
  from `POSES` at request time — never hand-edit CSS, and never add a pose
  without adding it there.

## Palette

Sampled from the sprite itself, so UI chrome matches the art.

| token | hex | where it comes from |
|---|---|---|
| `yolk` | `#fdcf2e` | body |
| `yolkDeep` | `#f0a81e` | body shading |
| `beak` | `#ff7709` | beak, feet |
| `brow` | `#882b00` | brow strokes |
| `plum` | `#48074f` | sprite outline — the accent colour |
| `plumSoft` | `#873f94` | outline midtone |
| `blush` | `#d585dd` | outline highlight |

## Files

| file | what |
|---|---|
| `chikny.webp` | the spritesheet, vendored verbatim |
| `logo.png` | row 8 col 2 (arms crossed, smug), trimmed to its bounding box |
| `icon-32.png` | favicon, nearest-neighbour so the pixels stay hard |
| `icon-180.png` | apple-touch-icon |
