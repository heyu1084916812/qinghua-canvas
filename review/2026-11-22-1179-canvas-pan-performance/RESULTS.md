# Canvas pan and zoom gesture performance (#1179)

## Load

- Tauri release + WebView2, 1440x900
- 300 mounted nodes, 500 edges, 150 decoded 64px real-image thumbnails
- Three non-trace pan, zoom, and single-node drag rounds
- Four UI combinations: 1440x900 / 1024x700 x light / dark
- Gate: P95 <= 20ms, visible DOM/store viewport movement, zero page or console errors

## Final formal run

| Gesture | P95 | P99 | Max |
| --- | ---: | ---: | ---: |
| Pan | 14.0 / 14.2 / 14.1ms | 20.6 / 21.1 / 20.7ms | 21.1 / 41.7 / 20.8ms |
| Zoom | 13.9 / 13.9 / 14.1ms | 14.2 / 21.1 / 21.0ms | 14.2 / 21.2 / 21.2ms |
| Single-node drag | 14.2 / 14.0 / 14.1ms | 21.0 / 20.3 / 21.4ms | 62.5 / 55.6 / 76.4ms |

The final report is **PASS**. All performance, movement, image, UI, and error
assertions pass.

## Gesture evidence

- Pan fast path: 63 / 70 / 77 mounted nodes, then 300 restored after every round.
- Zoom fast path: 96 / 117 / 126 mounted nodes, then 300 restored after every round.
- During pan: normal edge layer hidden, one merged path, CSS background active.
- During zoom: zero React Flow edge components and the windowed CSS-backed path.
- Pan screenshot is captured while the middle-button drag is still held.

## UI evidence

- All four viewport/theme combinations pass.
- Dragged about 78.26px and returned with 0px residual.
- Restored 300/300 nodes after every drag.
- Highest before/after changed-pixel ratio: 0.614%.
- Page and console errors: 0.

## Implementation

- `useFlowGestureWindow` computes a fixed node window from the viewport and a
  1000px screen-space warm margin.
- Pan removes all React Flow edges from the active tree and restores them on
  release.
- Wheel zoom uses the same node window but a 180ms end debounce, so a continuous
  wheel burst mounts nodes once instead of once per wheel event.
- `FlowNodeViewportCulling` pauses during a gesture and keeps the windowed nodes
  visible; it resumes the normal content virtualization after release.
- The large SVG background and 500 per-edge components are replaced by CSS
  patterns, one merged path, and ordinary/loop-node containment rules.

## Trace evidence

The diagnostic run with trace enabled still passed P95:

- Pan P95 14.2ms, zoom P95 14.0ms.
- Pan mounted 63 nodes; zoom mounted 88 nodes; all restored to 300.
- The compressed trace is included for attribution and regression analysis.

## Files

- `report.json`: final non-trace formal PASS report.
- `report.trace.json`: diagnostic trace-run report.
- `pan.trace.json.gz`: compressed trace from that run.
- `pan-active.png`: screenshot while panning.
- `ui-matrix/`: four viewport/theme before, drag, and after screenshots.

## Next optimization plan

There is no open performance requirement after this PASS. Use the following
order only if the user's real project still stutters.

1. **Measure gesture startup and release.** Add local marks around
   `onMoveStart`, the first fast-path frame, `onMoveEnd`, and full 300-node
   restoration. Gate the first useful frame at 16.7ms and restoration at 50ms.
2. **Make the window adaptive.** Compare 1000 / 800 / 600px warm margins at
   zoom 0.5 / 1 / 2 and cap the mounted set at 100 nodes. Reject a smaller
   margin if any node mounts mid-gesture or the fast layer drops a visible edge.
3. **Try a single proxy layer for extreme scenes only.** If the adaptive
   window still exceeds the gate, replace the gesture-time node DOM with one
   raster/canvas proxy, then restore the real tree on release. Do not ship it
   unless startup <=16.7ms, pan / zoom P95 <=16.7ms, P99 <=20ms, release <=50ms,
   and four-combination visual comparison stays acceptable.
4. **Separate multi-select drag.** Do not extend the single-node drag policy to
   multi-select until it has its own real-image load and four-combination gate.

Do not use BVH / a spatial index, global React caching, permanent image hiding,
or a relaxed 20ms threshold as substitutes for measuring browser mounting and
layerization.
