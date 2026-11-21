# Canvas release performance gate

Status: **PASS**

- graph: 300 nodes / 500 edges; mounted 300 nodes / 500 edges
- assets: 150 PNG rows; stored 150; thumbLength rows 150
- images: rendered 150 / decoded 150 / thumb 150; expected width 64px
- environment: Tauri release + WebView2, 1440x900, sqlite-v2 on port 18772
- pan P95: 14.20ms / 14.10ms / 14.10ms
- pan movement: PASS / PASS / PASS
- zoom P95: 14.10ms / 14.10ms / 14.10ms
- zoom movement: PASS / PASS / PASS
- pan worst frame: 21.40ms / 21.10ms / 21.10ms
- zoom worst frame: 21.10ms / 21.20ms / 21.20ms
- pan main-thread task: 1706.9ms / 1793.5ms / 1630.6ms
- zoom main-thread task: 1001.9ms / 985.2ms / 916.2ms
- culling UI matrix: PASS
- errors: page 0 / console 0
- screenshot: .playwright-verify\canvas-perf-release-2026-11-21T18-50-29-271\canvas.png
