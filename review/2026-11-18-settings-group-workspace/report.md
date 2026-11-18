# SettingsPage 按卡拆分 · 第 2 步「分组卡」取证（2026-11-18 / #1144）

**目的**：把「Key 分组 + 模型列表」抽成 `SettingsChannelGroupWorkspaceCard` 之后，
证明界面一个像素都没变。

**做法**：同一支探针 `scripts/probe-settings-connection-card.mjs` 跑两遍——
`git stash push -u -- src/pages/SettingsPage architecture/module-governance.json` 之前是 `before/`，
恢复之后是 `after/`，两遍都用同一份本地数据（第 7 条渠道）与同一组视口。

## 一、结论

| 判据 | 结果 |
| --- | --- |
| 截图逐张 SHA256 | **12 / 12 张完全相同**（`hashes.txt`） |
| 19 个锚点（含 `group-workspace` / `key-groups` / `key-group-switcher` / `settings-models`）的 rect / 背景 / 圆角 / 边框 / 内距 / gap / 字号 / 字重 / 溢出 | **逐项 0 差异** |
| `[data-settings-form]` 子节点顺序 | before = after = `provider-head → connection → group-workspace → mapping → quicktest` |
| 横向溢出 / 运行期错误 | 四组 `formOverflow=0`、`docOverflow=0`、`pageErrors=0` |

## 二、实测几何（after）

| 视口 × 主题 | 分组卡 rect | Key 分组条 | 模型列表 |
| --- | --- | --- | --- |
| 1440×900 深 / 浅 | x=524 y=536.28 844×144.80 | 844×46 | 844×98.80 |
| 1024×700 深 / 浅 | x=476 y=528.28 492×165.59 | 492×46 | 492×119.59 |

## 三、文件

- `before/` / `after/`：各 4 组（1440×900、1024×700 × 明暗）× 3 张
  （`head-*`、`connection-*`、`form-*`）+ `geometry.json`
- `hashes.txt`：24 张截图的 SHA256 对照

## 四、复跑

```powershell
node scripts/probe-settings-connection-card.mjs after review/2026-11-18-settings-group-workspace
```
