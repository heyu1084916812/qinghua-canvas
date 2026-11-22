# Canvas release performance gate

Status: **PASS**

- graph: 300 nodes / 500 edges; mounted 300 nodes / 500 edges
- assets: 150 PNG rows; stored 150; thumbLength rows 150
- images: rendered 150 / decoded 150 / thumb 150; expected width 64px
- environment: Tauri release + WebView2, 1440x900, sqlite-v2 on port 18772
- pan P95: 7.30ms / 7.30ms / 13.90ms
- pan movement: PASS / PASS / PASS
- zoom P95: 7.30ms / 7.30ms / 7.30ms
- zoom movement: PASS / PASS / PASS
- pan worst frame: 14.30ms / 34.80ms / 21.00ms
- zoom worst frame: 7.40ms / 28.00ms / 14.20ms
- pan main-thread task: 1477.1ms / 1281.3ms / 1478.1ms
- zoom main-thread task: 882.4ms / 1033.4ms / 961.7ms
- drag P95: 14.30ms / 7.30ms / 7.40ms
- drag movement: PASS / PASS / PASS
- drag worst frame: 48.90ms / 38.73ms / 41.80ms
- culling UI matrix: not requested
- errors: page 0 / console 0
- screenshot: .playwright-verify\canvas-perf-release-2026-11-22T16-49-54-814\canvas.png
