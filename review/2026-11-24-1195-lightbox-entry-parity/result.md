# #1195 / #1197 灯箱六入口的动画统一

## 根因

不同打开入口各自构造或漏传源媒体快照。缺少 `assetHash`、`kind`、`src` 或源节点时，灯箱无法在目标媒体首帧立即复用节点当前图片，导致各入口的目标就绪时机和 FLIP 节奏不同。

## 修复

所有入口统一使用同一套源快照，记录矩形、圆角、图片 / 视频类型、当前 URL 与 hash。节点入口走 `lightboxSourceRectForNode()`，日志与 Agent 活动缩略图走 `lightboxSourceRectForThumbnail()`。灯箱打开 API 都接收同一份 `LightboxSourceRectSnapshot`；旋转、标注、裁剪、提取选区、框脸、多选灯箱、右键菜单、Agent 工具、日志、活动缩略图与深链均携带该快照，裁剪还补齐了 `sourceNodeId`。

## 验证

- G1195 对同一素材依次走双击、预览、提取选区、裁剪、标注、旋转六个真实入口。
- 六入口起点均为 `238×238`，首帧 blob URL 全部相同。
- 六入口最终媒体均为 `66×66 @ (608,368)`，clone 结束时间范围 `456.5–471.0ms`。
- 六入口仍分别进入正确的灯箱模式。
- `1440×900 / 1024×700 × 明暗` 四组合 G1195 均 `6/6`。
- 日志与 Agent 活动缩略图按按钮内真实 `img / video` 取快照；灯箱 / store / 缩略图定向测试 `55/55`。

`after/` 中每种视口与主题各有 `dblclick / preview / extract / crop / annotate / rotate` 六张截图。
遗留的 `*-toolbar.png` 来自上一轮双入口版本，不参与本次 #1197 验收。
