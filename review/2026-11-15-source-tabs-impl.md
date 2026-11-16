# #1133 模型菜单内嵌来源切换（API / 工作流 / CLI）· 实现报告

日期：2026-11-15 开工，2026-11-16 收尾门禁。状态：**已落地（未 push）**；本机 CLI 来源待 Windows 真机验收（对账清单 §3.3）。
对账记录：`ledger/按批记录-2026-11-b.md`「交付：#1133」。

## 一、做了什么

生成节点的「来源」不再是单独一行 / 条目 Launcher 下拉，而是并进模型菜单顶部三个标签（API / 工作流 / CLI）。节点记住自己的来源（`data.source`），各来源参数分开存（`sourceSlots`），切来切去互不串；提交体只带当前来源的参数。

## 二、提交列表（本地，未推送）

| 提交 | 内容 |
| --- | --- |
| `ea3e7924` | A：节点来源判定 + 按来源分存参数的切换补丁；提交体只带当前来源参数（修 API 比例串进 RunningHub `aspectRatio`） |
| `7a0afd5d` | B：`cli:<tool>` 真路由到本机 CLI 执行器 + 运行前拦截，产物经执行引擎回填节点 |
| `a7f67519` | C：Agent 建生成节点只用 API 来源，条目 / 本机 CLI 模型不进配方 |
| `eef6c083` | D：工作流参数行改接模型菜单（modelPicker），删条目 Launcher 下拉 |
| `05ac9532` | E：模型菜单内嵌来源切换（三标签）+ 来源判定 / CLI 参数行 / 本机 CLI 来源 hook |
| `74385d20` | F：模块治理登记 |
| `90c37811` | 目检：API 行单行 46px，只有有用信息才两行 |
| `4ec3de2c` | 目检：新建节点未存模型时 API 标签勾上实际生效的默认模型 |
| `55fc6323` | 目检：被拦说明按剩余宽度伸缩、最多两行、只在标点处折，不再挤掉生成按钮 |
| `b3fb250e` | 截图证据 |
| （本报告所在提交） | 对账清单 + 本报告 |
| （#1133 API 菜单不按渠道分组，保留路由） | 目检：API 标签平铺、按全局模型名去重、不显示渠道名，没有渠道提供的放末尾「未配置」；行的 `pick` 只带模型名，渠道仍由面板按全局路由补（与改动前单列下拉同口径）；截图未重拍 |

> **注意**：提交 D 单独不能编译（删了 Launcher 但新菜单在 E），需与 E 一起；整批推送不受影响，二分查找时跳过 D。

## 三、逻辑项实测（a–e）

环境：Linux 沙箱 Chromium + 隔离 shared-store（`/health.dataDir` 在 `/tmp/`），vite 1420。**所有非本机外发请求都被 Playwright route 拦截并伪造 200，不真发、0 积分**。脚本：`work/source-tabs/after.mjs`、`work/source-tabs/api-body.mjs`（项目 scratch 目录，不随仓库）。

| 项 | 验什么 | 结果 |
| --- | --- | --- |
| a | API 选 GPT Image 2 + 4 张 → 切工作流 Z-Image 选 48G：`source` / `sourceSlots` 分存正确，角标变工作流 | ✅ 通过 |
| b | 工作流来源运行：提交体只带 `workflow` + `instanceType`（+ 条目参数），**不含 API 的 `aspectRatio`** | ✅ 通过 |
| c | 切回 API：数量 4 恢复、菜单勾选正确；运行提交体只带 API 参数，不带工作流字段 | ✅ 通过 |
| d | 再回工作流：48G 恢复 | ✅ 通过 |
| e | 老节点（去掉 `source`）推断：`app:` 条目节点被正确收编；`cli:jimeng` 节点归 CLI，网页版运行前被拦、说明可读、**0 外发请求**，说明不挤生成按钮 | ✅ 通过 |

## 四、门禁（2026-11-16）

- **vitest**：`--maxWorkers=1 --shard=i/20` 串行 20 片全过，合计 **786 文件 / 6449 用例通过**，1 文件 1 用例跳过（`scripts/ffmpeg-pack.integration.test.mjs`，按设计在无打包产物时跳过）。逐片：

  | 片 | 文件 | 用例 | 片 | 文件 | 用例 |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 40 | 362 | 11 | 39 | 356 |
  | 2 | 40 | 289 | 12 | 39 | 354 |
  | 3 | 40 | 488 | 13 | 39 | 219 |
  | 4 | 40 | 354 | 14 | 39 | 317 |
  | 5 | 40 | 297 | 15 | 39 | 262 |
  | 6 | 40 | 336 | 16 | 39 | 325 |
  | 7 | 40 | 291 | 17 | 39 | 277 |
  | 8 | 39 | 258 | 18 | 39 | 344 |
  | 9 | 39 | 384 | 19 | 39 | 293 |
  | 10 | 39 | 272 | 20 | 38（+1 跳过） | 371（+1 跳过） |

- **npm run check**（分段跑，全部 exit 0）：`tsc --noEmit`、`eslint .`、`depcruise`（1350 模块 0 违规）、architecture-rules、module-governance、versions（0.1.17 七值一致）、`test-canvas-mcp`（**Linux 无 PowerShell 跳过，可接受**）、theme、contrast、shell-geometry、rail-buttons、doc-index、doc-migration、doc-size、ledger、ledger-index --check、libtv-catalog、updater-config。文档提交后 ledger / ledger-index / doc-size 复跑通过。
- **npm run build**：`tsc --noEmit` + `vite build` 通过。
- 门禁全过，**无需修复提交**。

## 五、截图

`review/2026-11-15-source-tabs-evidence/`：`before/`（旧模型菜单、条目 Launcher，12 张）、`after/`（API / 工作流 / CLI 锁定标签、选中态、带来源角标 chip、CLI 被拦提示，28 张），均为 1440×900 与 1024×700 × 明暗。

## 六、遗留 / 已知限制

1. **选中行 ✓ 太小、暗色下难见**（视觉，未改）。
2. **截图依赖字体配置**：沙箱截图需 `FONTCONFIG_FILE=/tmp/qh-fonts/fonts.conf`，否则中文缺字。
3. **多图第 2 张起提示词加「（第 2 次）」**：原有行为，不是本批引入。
4. **一次 RunningHub 渠道工作流模型变空**：实测中出现过一次，未能复现，留观察。
5. **CLI 登录态无法检测**：只能查命令在不在（`which`），登录过期要等真跑才报错。
6. **Windows 真机未验证**：本机 CLI 子进程真跑、产物回填只在假 CliPort 端到端单测里验过（对账清单 §3.3 #1133）。
7. 提交 D 单独不能编译（需与 E 一起），见第二节。
