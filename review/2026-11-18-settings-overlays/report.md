# SettingsPage 按卡拆分 · 第 4 步「两块 portal 浮层」取证（2026-11-18 / #1144）

**目的**：把服务资料抽屉与渠道右键菜单两块 `createPortal` 收进 `SettingsChannelOverlays`，
连菜单位置计算（`channelMenuPresentationFor`）一起搬走之后，证明界面一个像素都没变——
**包括两块浮层打开时的样子**。

**做法**：同一支探针 `scripts/probe-settings-connection-card.mjs` 跑两遍
（`git stash push -u -- src/pages/SettingsPage architecture/module-governance.json` 前后各一遍）。
本轮探针扩了两步：点齿轮开抽屉截图 → 用关闭键收起 → 右键渠道出菜单截图。

## 一、结论

| 判据 | 结果 |
| --- | --- |
| 截图逐张 SHA256 | **20 / 20 张完全相同**（12 张表单类 + 8 张浮层：抽屉 / 菜单 × 四组视口×主题，见 `hashes.txt`） |
| 19 个锚点的 rect / 背景 / 圆角 / 边框 / 内距 / gap / 字号 / 字重 / 溢出 | **逐项 0 差异** |
| 横向溢出 / 运行期错误 | 四组 `formOverflow=0`、`docOverflow=0`、`pageErrors=0` |
| 浮层行为 | `g74 59/59`（点齿轮开资料抽屉、右键出菜单、菜单内编辑 / 删除确认都在这一组） |

## 二、浮层实测尺寸（after，四组一致）

| 浮层 | 1440×900 | 1024×700 |
| --- | --- | --- |
| 资料抽屉 | 360×395 | 360×341 |
| 右键菜单 | 184×80 | 184×80 |

`docOverflow=0` 同时说明：窄视口下菜单位置计算（右 / 下侧夹取）没有把菜单顶出屏幕。

## 三、文件

- `before/` / `after/`：各 4 组 × 5 张（`head-*`、`connection-*`、`form-*`、`drawer-*`、`menu-*`）+ `geometry.json`
- `hashes.txt`：40 张截图的 SHA256 对照

## 四、复跑

```powershell
node scripts/probe-settings-connection-card.mjs after review/2026-11-18-settings-overlays
```
