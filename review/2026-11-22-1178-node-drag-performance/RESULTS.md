# Node drag performance (#1178)

## Load

- Tauri release + WebView2, 300 mounted nodes, 500 edges, 150 decoded real PNG assets
- Three real pointer drag rounds; the node must visibly move at least 80px and return to its origin
- Threshold remains P95 <= 20ms

## Before and after

| Measurement | Before | After |
| --- | ---: | ---: |
| Drag P95 | 69.4 / 69.4 / 62.6ms | 7.3 / 7.3 / 7.3ms |
| Drag P99 | 76.7 / 76.3 / 69.5ms | 21.3 / 7.6 / 20.6ms |
| Drag script time | ~6.5s | 0.73-0.84s |
| Minor GC count in one trace | 104 | 20 after projection reuse |

The final report is `report.json`. Its overall status is FAIL only because the
separate existing pan gate landed at 20.7-21.0ms in the current machine session.
All three node-drag rounds pass, with zero page or console errors.

## Changes

- Reuse unchanged React Flow node and edge projection objects; only the moving
  node receives a new wrapper position.
- Keep the moving node's content `data` stable during the active drag and rebuild
  it once after release.
- Coalesce position commits to at most one graph update per animation frame.
- Reuse unchanged node-header labels and port hit geometry.
- During single-node drag only, temporarily render visible React Flow elements
  and unmount the port / child-edge hit layers; release restores all 300 nodes.

## UI evidence

The four combinations are 1440x900 / 1024x700 x light/dark. During drag each
cell moved ~78px, returned with 0px residual, restored 300/300/300/300 nodes,
and stayed under 0.6% changed-pixel ratio against the previous render path.

## GitHub references

- xyflow issue #4239: the measured bottleneck is React mounting/updating and
  DOM layerization, not the naive spatial intersection loop.
- xyflow issue #4711: complex custom-node CSS and simultaneous DOM layers are
  major sources of frame drops.
- xyflow issue #5765: graph-wide interactions can unnecessarily update every
  node/handle; memoization alone does not prevent graph-wide prop churn.
