# Canvas release performance gate

Status: **FAIL**

- graph: 300 nodes / 500 edges; mounted 300 nodes / 500 edges
- assets: 150 PNG rows; stored 150; thumbLength rows 150
- images: rendered 150 / decoded 150 / thumb 150; expected width 64px
- environment: Tauri release + WebView2, 1440x900, sqlite-v2 on port 18772
- pan P95: 14.10ms / 20.50ms / 14.10ms
- pan movement: PASS / PASS / PASS
- zoom P95: 20.90ms / 27.90ms / 20.90ms
- zoom movement: PASS / PASS / PASS
- pan worst frame: 21.10ms / 21.10ms / 21.00ms
- zoom worst frame: 27.90ms / 34.90ms / 27.90ms
- pan main-thread task: 2035.3ms / 1976.3ms / 2021.8ms
- zoom main-thread task: 1380.7ms / 1759.5ms / 1341.1ms
- drag P95: 14.10ms / 14.00ms / 14.10ms
- drag movement: PASS / PASS / PASS
- drag worst frame: 62.60ms / 41.90ms / 52.53ms
- culling UI matrix: PASS
- errors: page 0 / console 0
- screenshot: .playwright-verify\canvas-perf-release-2026-11-22T11-39-05-534\canvas.png
