# Canvas gesture background parity (#1180)

## Root cause

- Node dragging does not enter the viewport fast path. In the probe it keeps
  `data-viewport-moving=false`, the normal React Flow background stays visible,
  and the background color does not change.
- Canvas panning enters `FlowViewportBackground`. The original React Flow SVG
  dot uses `r = 0.7 × zoom`; the old CSS replacement used a fixed `1.4px`
  radial-gradient stop. At 100% its dot area was four times larger, and it grew
  relatively more visible as zoom decreased.
- The color token itself never changed. The heavier coverage made the canvas
  look darker or lighter.

## Fix

`FlowViewportBackground` now reads `--canvas-grid-line` once when the gesture
layer mounts, builds a small SVG dot tile with the original 22px gap and 0.7
radius, and uses it as a normal CSS `background-image`. The viewport only
updates `background-size` and `background-position`; both gap and dot radius
therefore scale together with zoom.

The generated color is restricted to hex or `rgb[a]()` values. Grid mode keeps
the CSS line gradients.

## Visual verification

- Actual pre-fix probe: `before-1440-dark.png`,
  `pan-active-1440-dark.png`, `node-drag-active-1440-dark.png`.
- Four combinations: 1440x900 / 1024x700 x light / dark, each with before,
  pan-active and node-drag screenshots. `matrix-before.json` applies the exact
  old fixed-1.4px radial-gradient rule as a controlled baseline; the actual
  pre-fix probe files are retained separately.
- Same-position blank-canvas sampling, 18,000 pixels:
  - Pre-fix dark: 244 changed pixels, mean delta 0.201, max 26.
  - Pre-fix light: 244 changed pixels, mean delta 0.194, max 25.
  - Fixed dark: 0 changed pixels.
  - Fixed light: 0 changed pixels.
- All four combinations have `errors=[]`; node dragging never switches to the
  gesture background.

## Performance regression

Final Tauri release + WebView2 gate: **PASS**

- Pan P95: `7.3 / 7.3 / 13.9ms`
- Zoom P95: `7.3 / 7.3 / 7.3ms`
- Drag P95: `14.3 / 7.3 / 7.4ms`
- 300 nodes / 500 edges / 150 decoded images mounted
- 300/300 nodes restored after every round
- Page errors 0 / console errors 0

The Vite dev server was paused during the final gate because it was consuming
about 403% CPU and caused unrelated drag P95 values around 20.8ms. It was
restarted afterward.

## Evidence

- `matrix-before.json` / `matrix-after.json`
- `before-*` / `after-*` screenshots
- `performance-report.json`: copied final non-trace performance PASS report
- `performance-REPORT.md`
- `performance-canvas.png`
- Final run root:
  `.playwright-verify/canvas-perf-release-2026-11-22T16-49-54-814`
