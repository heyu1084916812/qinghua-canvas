# Canvas release performance gate

Status: **PASS**

- graph: 300 nodes / 500 edges; mounted 300 nodes / 500 edges
- assets: 150 PNG rows; stored 150; thumbLength rows 150
- images: rendered 150 / decoded 150 / thumb 150; expected width 64px
- environment: Tauri release + WebView2, 1440x900, sqlite-v2 on port 18772
- pan P95: 14.00ms / 14.20ms / 14.10ms
- pan movement: PASS / PASS / PASS
- zoom P95: 13.90ms / 13.90ms / 14.10ms
- zoom movement: PASS / PASS / PASS
- pan worst frame: 21.10ms / 41.70ms / 20.80ms
- zoom worst frame: 14.20ms / 21.20ms / 21.20ms
- pan main-thread task: 2096.1ms / 2119.3ms / 2094.4ms
- zoom main-thread task: 1217.7ms / 1449.8ms / 1480.2ms
- drag P95: 14.20ms / 14.00ms / 14.10ms
- drag movement: PASS / PASS / PASS
- drag worst frame: 62.50ms / 55.60ms / 76.40ms
- culling UI matrix: PASS
- errors: page 0 / console 0
- screenshot: .playwright-verify\canvas-perf-release-2026-11-22T13-01-02-139\canvas.png
