# Canvas pan gesture performance (#1179)

## Load

- Tauri release + WebView2, 1440x900
- 300 mounted nodes, 500 edges, 150 decoded 64px real-image thumbnails
- Three non-trace pan, zoom, and single-node drag rounds
- Four UI combinations: 1440x900 / 1024x700 x light / dark
- Gate remains P95 <= 20ms and viewport movement must be observable in both DOM and store

## Final formal run

| Gesture | P95 | P99 | Max |
| --- | ---: | ---: | ---: |
| Pan | 14.1 / 20.5 / 14.1ms | 20.9 / 21.0 / 20.9ms | 21.1 / 21.1 / 21.0ms |
| Zoom | 20.9 / 27.9 / 20.9ms | 27.9 / 34.7 / 27.8ms | 27.9 / 34.9 / 27.9ms |
| Single-node drag | 14.1 / 14.0 / 14.1ms | 21.0 / 21.1 / 21.0ms | 62.6 / 41.9 / 52.5ms |

The overall report is **FAIL**. One pan round and all zoom rounds remain above
the 20ms gate. Drag P95 and every movement assertion pass.

## UI evidence

All four combinations pass:

- Dragged about 78.26px and returned with 0px residual.
- Restored 300/300 nodes after every drag.
- No page or console errors.
- Highest before/after changed-pixel ratio: 0.616%.
- During-pan screenshot confirms the temporary grid and merged edge layer render.

## Gesture implementation

- `onMoveStart` synchronously marks the canvas before React commits another frame.
- Pan temporarily removes React Flow's 500 edge components and paints one merged
  world-space path plus selected/related edges.
- The large SVG background is replaced by a CSS pattern driven by two viewport
  properties. The pattern remains in world space.
- Pan sets node hit testing through the pane and adds layout/style containment to
  ordinary nodes. Loop nodes are excluded. Definitions restore on `onMoveEnd`.
- Wheel zoom deliberately stays on the complete edge layer to avoid repeated
  component mount/unmount.

## Trace comparison

Compared with the pre-change release trace:

- `FunctionCall`: 655.3ms -> 628.6ms.
- `EventDispatch`: 633.8ms -> 543.8ms, down about 14%.
- Maximum pan frame in the formal run dropped below 33ms; previous reports
  included a 28ms frame.
- Browser costs moved in the opposite direction: `HitTest` 402.5ms -> 532.0ms,
  `Layerize` 224.5ms -> 329.1ms, `Paint` 147.9ms -> 218.3ms.

The gesture layers therefore reduce JavaScript dispatch and the worst frame but
do not solve the remaining browser paint/layer cost. They must not be reported
as a full pan/zoom performance pass.

## Files

- `report.json`: final non-trace formal run.
- `report.trace.json`: diagnostic run with trace enabled on round one.
- `pan.trace.json.gz`: compressed trace from the diagnostic run.
- `pan-active.png`: screenshot while the middle-button pan is still held.
- `ui-matrix/`: four viewport/theme screenshots before, during drag, and after.
