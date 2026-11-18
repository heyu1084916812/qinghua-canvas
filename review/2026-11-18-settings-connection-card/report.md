# SettingsPage 按卡拆分 · 第 1 步「连接卡」取证（2026-11-18 / #1144）

**目的**：把「服务资料头 + 连接与鉴权」抽成 `SettingsChannelConnectionCard` 之后，
证明**界面一个像素都没变**（纯结构搬迁，不是改版）。

**做法**：同一支探针 `scripts/probe-settings-connection-card.mjs` 跑两遍——
`git stash push -u -- src/pages/SettingsPage architecture/module-governance.json` 之前是 `before/`，
恢复之后是 `after/`。两遍都用同一份本地数据（第 7 条渠道）与同一组视口。

## 一、结论

| 判据 | 结果 |
| --- | --- |
| 截图逐张 SHA256 | **12 / 12 张完全相同**（`hashes.txt` 里 before / after 同名文件哈希一致） |
| 16 个锚点的 rect / 背景 / 圆角 / 边框 / 内距 / gap / 字号 / 字重 / 溢出 | **逐项 0 差异**（`before/geometry.json` vs `after/geometry.json`） |
| `[data-settings-form]` 子节点顺序 | before = after = `data-settings-provider-head → connection → data-settings-group-workspace → mapping → quicktest` |
| 横向溢出 | 四组 `formOverflow = 0`、`docOverflow = 0` |
| 运行期错误 | 四组 `pageErrors = 0` |

## 二、实测几何（after，四组一致）

| 视口 × 主题 | 资料头 | 连接卡 rect | 卡片底色 | 圆角 |
| --- | --- | --- | --- | --- |
| 1440×900 深 | 844×38 | x=524 y=292.80 844×219.48 | `rgb(31, 31, 31)` | 10px |
| 1440×900 浅 | 844×38 | x=524 y=292.80 844×219.48 | `rgb(245, 245, 245)` | 10px |
| 1024×700 深 | 492×38 | x=476 y=284.80 492×219.48 | `rgb(31, 31, 31)` | 10px |
| 1024×700 浅 | 492×38 | x=476 y=284.80 492×219.48 | `rgb(245, 245, 245)` | 10px |

## 三、文件

- `before/` / `after/`：各 4 组（1440×900、1024×700 × 明暗）× 3 张
  （`head-*` 服务资料头、`connection-*` 连接卡、`form-*` 整张表单）+ `geometry.json`
- `hashes.txt`：12 张 after 截图与 12 张 before 截图的 SHA256 对照

## 四、复跑

```powershell
# 需要 :1420 的开发实例（探针读本机真实渠道数据）
node scripts/probe-settings-connection-card.mjs after
```
