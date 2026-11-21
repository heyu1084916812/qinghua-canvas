# Canvas performance result (#1021 / #971)

## Environment

- Tauri release + installed WebView2, 1440 x 900, DPR 1
- 300 mounted nodes, 500 mounted edges
- 150 unique real PNG assets, all rendered and decoded as 64 x 64 WebP thumbnails
- Production gate threshold: P95 <= 20ms for each of three pan and three zoom rounds

## Root cause

The old probe never proved that the canvas moved: Space + left mouse was no longer
panning, and each zoom pair cancelled itself. After fixing the probe, the real
release trace showed 200 `Layerize` events totaling about 1246ms in one pan round,
with a maximum of 18.45ms. Hiding edges or rendering every node did not help.

The hot path was `content-visibility:auto` on all 300 nodes while React Flow
continuously transformed the viewport. The change keeps every node mounted but
imperatively switches top-level prompt/generation wrappers between
`content-visibility:hidden` outside the padded viewport and `visible` inside it.
Containers, loop, fusion and child nodes keep their previous path.

## Trace comparison

| Trace | Layerize count | Layerize total | Layerize max |
| --- | ---: | ---: | ---: |
| Before culling | 200 | ~1246ms | 18.45ms |
| After culling | 231 | ~228ms | 3.46ms |

The trace-enabled validation itself produced one 20.5ms pan round and is retained
as a failed evidence run. Three subsequent no-trace release runs passed.

## Passing runs

| Run | Pan P95 (ms) | Zoom P95 (ms) |
| --- | --- | --- |
| `canvas-perf-release-2026-11-21T18-47-18-756` | 14.4 / 14.2 / 14.1 | 14.0 / 14.1 / 14.2 |
| `canvas-perf-release-2026-11-21T18-50-29-271` | 14.2 / 14.1 / 14.1 | 14.1 / 14.1 / 14.1 |
| `canvas-perf-release-2026-11-21T18-54-46-297` | 14.2 / 14.2 / 14.1 | 14.1 / 14.0 / 14.1 |

All three runs had 300/300 nodes, 500/500 edges, 150/150 decoded images and zero
page or console errors.

## UI verification

`ui-matrix/` compares the current implementation with the previous
`content-visibility:auto` behavior at 1440x900 and 1024x700 in light and dark
themes. The maximum changed-pixel ratio was 0.61%, all node geometry was stable,
all 150 images remained rendered/decoded, and no horizontal overflow occurred.
