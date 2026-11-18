# SettingsPage 按卡拆分 · 第 3 步「映射卡」取证（2026-11-18 / #1144）

**目的**：把「模型映射」抽成 `SettingsChannelMappingCard`、并把前端模型目录的增删绑
（`addGlobalModel` / `removeGlobalModel` / `setModelBinding` / `setModelUncommon`）
从 `channelActionCoordinator` 搬进 `useChannelMappingDraft` 之后，证明界面一个像素都没变。

**做法**：同一支探针 `scripts/probe-settings-connection-card.mjs` 跑两遍——
`git stash push -u -- src/pages/SettingsPage architecture/module-governance.json` 之前是 `before/`，
恢复之后是 `after/`，两遍都用同一份本地数据（第 7 条渠道）与同一组视口。

## 一、结论

| 判据 | 结果 |
| --- | --- |
| 截图逐张 SHA256 | **12 / 12 张完全相同**（`hashes.txt`） |
| 19 个锚点（含 `data-settings-section="mapping"`）的 rect / 背景 / 圆角 / 边框 / 内距 / gap / 字号 / 字重 / 溢出 | **逐项 0 差异** |
| `[data-settings-form]` 子节点顺序 | before = after = `provider-head → connection → group-workspace → mapping → quicktest` |
| 横向溢出 / 运行期错误 | 四组 `formOverflow=0`、`docOverflow=0`、`pageErrors=0` |
| 映射区的行为回归 | `g74 59/59`（含「前端模型图标库完整」「标为不常用后立即隐藏」两条走的正是搬走的动作）、`g83 4/4`（分类过滤） |

## 二、实测几何（after）

| 视口 × 主题 | 映射卡 rect |
| --- | --- |
| 1440×900 深 / 浅 | x=524 y=705.08 844×226 |
| 1024×700 深 / 浅 | x=476 y=717.88 492×240 |

## 三、文件

- `before/` / `after/`：各 4 组（1440×900、1024×700 × 明暗）× 3 张 + `geometry.json`
- `hashes.txt`：24 张截图的 SHA256 对照

## 四、复跑

```powershell
node scripts/probe-settings-connection-card.mjs after review/2026-11-18-settings-mapping-card
```
