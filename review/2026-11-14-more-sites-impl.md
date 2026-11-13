# 调研 live-run 五个 bug + 更多设计站 · 实现报告（#1090–#1098，2026-11-14）

来源：用户 2026-11-14 批准「修 live-run 的 5 个 bug + 加更多设计站」，以及追加要求「每个来源挑一张 → 存成项目参考 → 放到画布」。
全部本地提交，**未 push**，未访问 65535.space。对账清单行 #1090–#1098（`轻画-功能对账清单.md` 顶部「缺口汇总追加（2026-11-14…）」）。
（同一份报告也拷进仓库 `qinghua-canvas/review/2026-11-14-more-sites-impl.md` 随提交。）

## 提交

| 提交 | 内容 | 涉及 UI |
|---|---|---|
| `a85cf1d7` | #1090 遇墙提示 45s 超时、每站时限与等用户宽限；已就绪结果不再被浏览器站卡住；每站每次运行最多提示一次 | 否 |
| `377f1276` | #1091 被验证 / 登录挡住的站不算搜到：不带遮挡条目、不进 `usedSources` | 否 |
| `b1feabf1` | #1092 各站检索状态（`siteStatuses`）进工具结果与模型投影 | 否 |
| `db42a828` | #1093 英文站优先用模型给的英文检索角度 | 否 |
| `3ca41780` | #1094 新增 Cosmos / BP&O / Lovely Package 直连；The Dieline 改 WordPress REST 直连；英文博客结果过题目相关性闸门 | 否 |
| `7743c8c5` | #1095 步骤标题站名与数字同一口径；图片模式写「等 N 个站」 | 是（已取证） |
| `e91b9bf6` | 治理：`agentResearchSourceLabel.ts` 预算 70→90（#1094/#1095 后 80 行） | 否 |
| `9b6e2a64` | #1096 调研没找到时阶段行 / 折叠摘要写「联网调研没完成」，不再折叠成「调研完成」（`phase.ts` 预算 110→120） | 是（文案，已取证） |
| `f90a7e70` | #1097 Packaging of the World 图片存不进素材库（来源标签 22 字 > 16 字上限被截断 ⇒ 回读校验失败） | 否 |
| `5bf214df` | #1098 调研图片「下载」先走公开网络通道直取字节（不受图床 CORS 限制），按实际格式命名 | 否 |
| （本报告 docs 提交） | | |

注：#1098 的对账清单行随 `f90a7e70` 一起提交（两行同一次编辑写入），代码与测试在 `5bf214df`。

## Bug 修复摘要

- **#1090（高）** Pinterest 没登录时每次找图都卡在「需要你处理一下」：遇墙提示 45s 超时按取消；直连站 30s / 浏览器站 70s 时限；其它站结束后只再宽限 15s 就撤提示交结果；每站每次运行最多提示一次。
- **#1091（中）** 被挡的站留了 1 张遮挡图就被算 `ok` 进 `usedSources` ⇒ 仍被挡即记 `needs-login` / `blocked`、不带条目。
- **#1092（低）** 模型不知道哪些站被挡 ⇒ `siteStatuses: {site,status,itemCount,note?}[]` 进结果与投影。
- **#1093** 英文站只用前 2 个检索角度（常为中文）⇒ 英文站至少用到一条英文角度。
- **#1095（低）** 标题「…· 5 个网页」站名截 4 个、数字数 5 个 ⇒ 最多 3 个站名 +「等 N 个站」，图片模式不写「网页」。
- **#1096（低）** 0 条结果时折叠行仍是「调研完成」⇒ `agentPhaseStepLine(phase, label, failed)`，失败口径 `agentPhaseFailedTitle`（research ⇒「调研没完成」），文本与折叠摘要都写「联网调研没完成」。截图 before `review/2026-11-14-more-sites-evidence/before/*-oldweb-before.png`（折叠行「调研完成」）→ after `…/after/*-oldweb-after.png`（1440×900 / 1024×700 × 明暗，「联网调研没完成」，无横向溢出）。
- **#1097** live 实测：POTW 那张存成参考时退成「只有文字的来源参考」，拖不上画布。病根 `saveDesignResearchItem` 标签「Packaging of the World」被 `MAX_TAG_LEN=16` 截成「Packaging of the」，事务尾部标签回读不等 ⇒ 抛错回滚。改标签「Packaging World」，回读按 `normalizeTag` 比对。
- **#1098** 「下载」在桌面走 WebView `fetch`：BP&O、Lovely Package 图床不给 `Access-Control-Allow-Origin` ⇒ 只能交给系统浏览器打开；无扩展名的图（花瓣 `_fw658webp`、Cosmos）存成 `.jpg`。改为先走 `network.request publicOnly`（桌面 = Rust `fetch_text` reqwest），按实际格式命名，拿不到再退回 `saveFromUrl`。

## 站点：加入 / 拒绝

**加入（直连，`DIRECT_SITE_ADAPTERS` 轮转）**：花瓣 · 站酷 · **Cosmos**（`/search/elements/<词>` Apollo 补水，跳过 AI 生成与非 SAFE）· **The Dieline**（WordPress REST，避开无头浏览器的 hashcash）· **BP&O**（WordPress REST）· **Lovely Package**（REST 403 ⇒ 读 `/?s=` Elementor 卡）。英文博客结果过 `siteRelevance` 题目相关性闸门。
**浏览器站（Agent 后台浏览器）**：Dribbble · Packaging of the World · Pinterest（未登录 ⇒ 登录墙，`needs-login`）。

**拒绝**（沙箱实测原因）：

| 站 | 原因 |
|---|---|
| Are.na | Cloudflare 403，且搜索需登录 |
| Savee | 需登录 |
| Mindsparkle | robots.txt 禁抓 |
| Awwwards | Cloudflare 挑战 |
| Muzli 搜索 | 404 |
| 古田路9号 | robots.txt 禁抓 |
| 普象 | 超时 |
| 优设 | 需登录 |
| 设计癖 | 空壳页（无结果数据） |
| Pentawards 搜索 | 404 |
| World Brand Design Society | 纯 JS 壳，无可解析数据 |
| 小红书 | 跳过（登录 + 反爬，不接） |

## Live 重跑（2026-11-14，真实网络）

脚本 `work/live-run/run-research.mjs image …`：真实 `researchDesign` 工具链（tools.ts → agentToolResearch → runDesignResearch → 直连适配器 + Playwright Chromium 代替隐藏 WebView2 跑浏览器站），NetworkPort = Node fetch 仿桌面壳语义。
查询「帮我找一些好看的茶叶包装设计参考图」，参数 `mode=image`，角度 `茶叶包装设计 / tea packaging design / 茶叶礼盒包装 / tea packaging`。结果 `review/2026-11-14-more-sites/image.json`。

- 耗时 **15.0 s**（改前 live-run 在 Pinterest 提示上卡住），**40 条 / 8 个来源**，warnings 空。
- 每站：

| 站 | 状态 | 站点返回 | 合并后进结果 |
|---|---|---|---|
| 花瓣 | ok | 7 | 4 |
| 站酷 | ok | 7 | 4 |
| Cosmos（新） | ok | 7 | 3 |
| The Dieline（REST，新） | ok | 7 | 3 |
| BP&O（新） | ok | 5 | 3 |
| Lovely Package（新） | ok | 5 | 3 |
| Dribbble（浏览器） | ok | 14 | 10 |
| Packaging of the World（浏览器） | ok | 14 | 10 |
| Pinterest（浏览器） | **needs-login** | 0 | 0（提示一次 ⇒ 仍被挡 ⇒ 不进 `usedSources`，模型投影里写明「需要登录」） |

- 步骤标题「花瓣 · 站酷 · Cosmos 等 8 个站」（#1095 口径）。
- 图库截图（真实 `<App/>` + 共享存储，种子 = 这次真实结果）：`review/2026-11-14-more-sites/1440x900-light-gallery.png`，40/40 张缩略图加载（`naturalWidth>0`，`referrerPolicy=no-referrer`）。

## 每个来源一张：存成参考 → 下载 → 放到画布

脚本 `work/more-sites/save-place.mjs`、`work/more-sites/download-check.mjs`（Playwright，1440×900 浅色）。真实 `<App/>`、真实共享存储（`/tmp/qh-more`）、真实 web 平台装配；**唯一替身**是壳的 `remoteBytes.request`：Playwright 暴露 `__shellFetch`，Node 端用 curl 按 Rust `fetch_text(publicOnly)` 原样发——只带 JS 传入的头 + reqwest 默认 `accept: */*`，**无 User-Agent、无 Referer、不压缩**（reqwest 0.13 `default-features=false`，无 gzip），≤5 次跳转。这样「加入参考」和「下载」走的就是桌面同一条 `viaShell` 路径。

流程：图库里每个来源勾第一张 → 输入框发送（`commitResearchSelection` ⇒ `saveDesignResearchItem` 落素材库 + 参考台账 + 挂会话）→「我的素材」参考卡按 `application/x-qinghua-reference` 落到画布（`useCanvasDrop` ⇒ `dropReferenceToCanvas`，与拖拽同一实现）→ 读画布节点 `<img>`；另外每个来源在预览里点「下载」，接住浏览器 download 验字节。

| 来源 | Rust 头直取（状态 / content-type / 字节 / 魔数） | 存成项目参考 | 画布节点 naturalWidth | 下载（走壳 / 文件名后缀 / 字节） | 图床 ACAO（WebView fetch 能否直读） | 结果 |
|---|---|---|---|---|---|---|
| 花瓣 | 200 · image/webp · 136 588 · RIFF | ✅ 图片参考 | 526 ✅ | ✅ · .webp · 136 588 | `*` | **PASS** |
| 站酷 | 200 · image/png · 1 205 471 · PNG | ✅ | 640 ✅ | ✅ · .png · 1 205 471 | `*` | **PASS** |
| Cosmos | 200 · image/jpeg · 93 125 · JPEG | ✅ | 508 ✅ | ✅ · .jpg · 93 125 | `*` | **PASS** |
| The Dieline | 200 · image/jpeg · 58 995 · JPEG | ✅ | 640 ✅ | ✅ · .jpg · 58 995 | `*` | **PASS** |
| BP&O | 200 · image/jpeg · 791 107 · JPEG | ✅ | 480 ✅ | ✅ · .jpg · 791 107 | **无** | **PASS**（改前下载只能交给浏览器 ⇒ #1098） |
| Lovely Package | 200 · image/jpeg · 540 291 · JPEG | ✅ | 640 ✅ | ✅ · .jpg · 540 291 | **无** | **PASS**（同上 ⇒ #1098） |
| Dribbble | 200 · image/webp · 69 628 · RIFF | ✅ | 640 ✅ | ✅ · .webp · 69 628 | `*` | **PASS** |
| Packaging of the World | 200 · image/jpeg · 30 957 · JPEG | ✅（改前 ❌ 退成文字参考 ⇒ #1097） | 640 ✅ | ✅ · .jpg · 30 957 | `*` | **PASS**（修后） |

- 无 403 / 567 防盗链：8 张在「无 Referer、无 UA」请求下全部 200 且为真图片字节；声明的 content-type 与魔数一致。
- 画布：8 个参考 ⇒ 8 个节点，全部 `naturalWidth>0`，页面错误 0。画布节点 `naturalWidth` 是共享存储缩略图（≤640），原图字节在素材库。
- 证据：`review/2026-11-14-more-sites/save-place-live2.json`、`download-live2.json`、`download-check.json`、`1440x900-light-references.png`、`1440x900-light-canvas-placed.png`。
- 发送后对话里出现「出错：还没选模型」——harness 没配对话模型，属预期；参考存入发生在回合之前，不受影响。

## 门禁

（见文末「门禁结果」。）

## Windows 真机待验清单

1. 桌面版找图（同一句话）：Pinterest 未登录时不再卡在提示卡上（提示最多 45 s 自动撤，其它站结束后最多再宽限 15 s）；花瓣 / 站酷 / Cosmos / Dieline / BP&O / Lovely Package 先到。
2. 步骤标题「花瓣 · 站酷 · Cosmos 等 N 个站」不溢出；0 条结果时折叠行为「联网调研没完成」（明暗）。
3. 图库里每个来源勾一张发送 ⇒「我的素材 → 参考」出现 8 张图片参考（POTW 也是图片，不是文字卡）。
4. 参考卡拖到画布 ⇒ 节点显示图片；重开项目后仍在。
5. 预览「下载」：BP&O / Lovely Package 弹保存对话框直接存下（不再打开系统浏览器）；花瓣 / Dribbble 存成 `.webp`。
6. Rust `fetch_text` 在 Windows 系统代理开 / 关两种情况下 8 个图床都 200（沙箱只验了经环境代理）。
7. Agent 后台浏览器（WebView2）跑 Dribbble / POTW 的条数与 Playwright 相近（沙箱用 Chromium 代替）。

## 门禁结果

| 门禁 | 结果 |
|---|---|
| Vitest 4 分片串行 | shard1 187 files / 1667 tests ✅；shard2 187 / 1511 ✅；shard3 186 / 1414 ✅；shard4 185 + 1 skipped / 1545 + 1 skipped ✅（合计 746 files，6137 passed / 1 skipped） |
| `npm run check` | ✅（tsc、eslint、depcruise 1294 modules / 5147 deps、架构规则、模块治理 433 registrations、版本 / MCP / 主题 / 对比度 / 几何 / 文档索引等全部通过） |
| `npm run build` | ✅（3668 modules，6.66 s） |

首轮 check / build 因 `researchImageDownload.test.ts` 里 `vi.fn` 调用参数的元组类型报 TS2493 失败，`9a6419a1` 修正后重跑全部通过（分片在修正前跑，修正只改该测试的类型断言，单文件复跑 3/3 通过）。

## 环境教训（已写入 `.workbuddy/memory/MEMORY.md`）

- 素材标签 `MAX_TAG_LEN = 16`：新增来源时 `sourceTag` 必须 ≤16 字，否则 `saveDesignResearchItem` 的回读校验会让整张图存不进去（只剩文字参考）。
- harness 里要让「加入参考 / 下载」走桌面同一路径：给 web 平台装 `remoteBytes.request`（Playwright `exposeFunction` + curl 仿 reqwest：无 UA / Referer / 压缩，`accept: */*`）；纯 web 平台 `publicOnly` 失败关闭，什么都存不下。
