# #1181 密集画布拖动与手势性能结果

## 结论

节点追赶鼠标、拖动首帧长任务和低缩放密集平移已分开处理：

- 拖动期间由 `useFlowNodeDragDomFollow` 按 `pointermove` 直接写节点 transform 和关联边路径，store 在松手统一结算。
- `pointerup` 再补一次最终坐标，解决最后一个 move 被合并后残留一整步的问题。
- 拖动开始只通知 `subscribeDragging`，不再唤醒整图；拖后选中使用 `setSelectionAfterDrag`，保持创作面板关闭。
- 一次手势窗口达到 120 个节点时，pan / wheel zoom 改用 React Flow coarse 节点。
- 节点拖动期间非活动节点只显示同尺寸轮廓，活动节点和关联边保持完整反馈，松手立即恢复。

## 最终 release 门禁

正式目录：`.playwright-verify/canvas-perf-release-2026-11-23T09-31-57-941`

| 项目 | 三轮结果 |
| --- | --- |
| pan P95 | `6.2 / 6.2 / 6.2ms` |
| zoom P95 | `6.2 / 6.2 / 6.2ms` |
| drag P95 | `6.2 / 6.2 / 6.2ms` |
| 长拖动回位误差 | `0 / 0 / 0px` |
| 恢复节点 | `300 / 300 / 300` |
| 页面 / console error | `0 / 0` |

## 冷启动拖动

目录：`.playwright-verify/canvas-perf-release-2026-11-23T09-37-25-324`

| 轮次 | 按下到首次可见移动 | pointermove 到节点响应 | 拖动 P95 | 指针最大偏差 |
| --- | --- | --- | --- | --- |
| 1 | `22.9ms` | `0.6ms` | `6.2ms` | `0px` |
| 2 | `19.7ms` | `0.5ms` | `6.2ms` | `0px` |
| 3 | `18.9ms` | `0.4ms` | `6.2ms` | `0px` |

“按下到首次可见移动”包含测试驱动把第一个 pointermove 投递到页面的时间；节点收到 pointermove 后的实际响应均在 1ms 内。

## 四组合 UI

目录：`.playwright-verify/canvas-perf-release-2026-11-23T09-07-13-198/ui-matrix`

- `1440×900` 明 / 暗：短拖动移动 `89.44px`，回位 `0px`，几何稳定，无横向溢出。
- `1024×700` 明 / 暗：短拖动移动 `89.44px`，回位 `0px`，几何稳定，无横向溢出。
- 像素差最高约 `0.62%`，低于 2% 门禁。
- 截图包含 each 组合的 `before`、`after`、拖动中状态。

## 已否决的 A/B

| 方案 | 结果 | 结论 |
| --- | --- | --- |
| viewport `will-change` | 低缩放 pan P95 恶化到约 `84.8ms` | 大位图层不适合 |
| 隐藏节点图片 | pan P95 约 `54.6ms` | 只减绘制内容，没有消除节点层成本 |
| DOM 轮廓代理 | pan P95 约 `66.7ms` | 额外层仍要栅格化 |
| Canvas 单快照 | pan P95 约 `54.7ms` | WebView2 上无稳定收益 |
| 节点 `contain:strict` | pan P95 约 `72.7ms` | 增加层化成本 |
| 固定背景点阵 | 平均收益小且不稳定 | 不是主因 |

## 验证命令

- `npm run check`
- `npm test`
- `QH_PERF_STRESS=1 npm run perf:canvas:production`
- `QH_PERF_COLD_DRAG_ONLY=1 npm run perf:canvas:production`
- `QH_PERF_UI_MATRIX=1 QH_PERF_DIAGNOSTIC_ROUNDS=1 npm run perf:canvas:production`
