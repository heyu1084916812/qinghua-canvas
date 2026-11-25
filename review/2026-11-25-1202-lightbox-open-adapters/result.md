# #1202 灯箱查看入口收口

## 结构

- `openNodeLightbox()`：节点入口，负责从节点媒体取 `sourceRect` 并写入 `sourceNodeId`。
- `openThumbnailLightbox()`：缩略图入口，负责从按钮内真实 `img / video` 取 `sourceRect`。
- 动画、目标框等待、遮罩淡入和退场继续只存在于灯箱控制器。

## 迁移

- 节点双击与功能栏预览：`openNodeLightbox()`。
- 日志缩略图与 Agent StepThumb：`openThumbnailLightbox()`。
- 生产代码直接 `.openLightbox()` 只允许出现在适配器模块和 store 本体。

## 验证

- `lightboxOpen.test.ts` 覆盖节点 / 缩略图适配器 options 与来源快照。
- 同一测试扫描生产源码，发现绕过适配器的直接调用会失败。
- 定向测试 13/13。
- G49 与 G1195 四组合复验保持通过；每组均为 G49 22/22、G1195 8/8。
- 全量 Vitest 6685 passed / 1 skipped；check 与生产构建通过。

## 证据

- `smoke/2026-11-25T06-17-50/`
- `smoke/2026-11-25T06-20-29/`
- `smoke/2026-11-25T06-23-05/`
- `smoke/2026-11-25T06-25-43/`

每个目录保留 `summary.json`、`g49-smoke.log`、`g1195-smoke.log`。
