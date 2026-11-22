# Canvas release performance gate

Status: **FAIL**

- graph: 300 nodes / 500 edges; mounted 300 nodes / 500 edges
- assets: 150 PNG rows; stored 150; thumbLength rows 150
- images: rendered 150 / decoded 150 / thumb 150; expected width 64px
- environment: Tauri release + WebView2, 1440x900, sqlite-v2 on port 18772
- pan P95: 21.00ms / 20.70ms / 20.70ms
- pan movement: PASS / PASS / PASS
- zoom P95: 14.10ms / 14.20ms / 13.90ms
- zoom movement: PASS / PASS / PASS
- pan worst frame: 21.20ms / 28.00ms / 21.40ms
- zoom worst frame: 34.80ms / 27.80ms / 14.40ms
- pan main-thread task: 1882.8ms / 1929.5ms / 1819.9ms
- zoom main-thread task: 1058.1ms / 1075.1ms / 929.8ms
- drag P95: 7.30ms / 7.30ms / 7.30ms
- drag movement: PASS / PASS / PASS
- drag worst frame: 31.63ms / 34.70ms / 27.90ms
- culling UI matrix: PASS
- errors: page 0 / console 0
- screenshot: .playwright-verify\canvas-perf-release-2026-11-22T08-35-01-003\canvas.png
