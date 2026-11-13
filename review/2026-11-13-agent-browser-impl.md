# Agent 浏览器三件套实现报告（#1087–#1089，2026-11-13）

来源：用户 2026-11-13 派单「3) Agent browser tool / 4) Captcha/login wall / 5)「交给 Agent」按钮」。
全部本地提交，**未 push**。对账清单行 #1087 / #1088 / #1089。

| 提交 | 内容 | 涉及 UI |
|---|---|---|
| `b4926ab8` | #1087 Agent 后台浏览器（隐藏 WebviewWindow）+ Dribbble / The Dieline / POTW / Pinterest 适配器 | 否 |
| `2b499305` | #1088 验证 / 登录墙提示卡「需要你处理一下验证/登录，完成后点继续」 | 是（已取证） |
| `ccc62f12` | #1089 画布浏览器「交给 Agent」 | 是（已取证） |
| （本报告与门禁结果另起一笔 docs 提交） | | |

## #1087 Agent 后台浏览器

- **Rust** `src-tauri/src/agent_browser.rs`：label `agent-browser-<id>`、`visible(false)` 的独立 WebviewWindow，**与画布浏览器同一 `data_directory` / macOS data store** ⇒ 画布浏览器里登录过的站 Agent 直接带登录态。`load` = 给旧文档打标记 → `navigate` → 轮询 `readyState` → 往下滚 N 屏 → 沉降 → `eval_with_callback` 跑前端给的提取脚本（同步返回 JSON 字符串；每次 eval 带超时）。`show / hide / close / snapshot`；用户关掉亮出的窗口 = 拦下关闭、隐藏并发 `agent-browser:event {closed}`。`lib.rs` 的全局窗口事件跳过 `agent-browser-*`。`browser_view_extract`（画布浏览器原生视图执行同一脚本）给 #1089 用。
- **前端**：端口 `platform/agentBrowser.ts`（仅桌面壳）、自包含提取脚本 `siteAdapters/pageSnapshot.ts`、墙识别 `pageWall.ts`、四站模板 `browserSites.ts`、单站流程 `browserSiteRun.ts`；`runSiteAdapters` 有浏览器端口时四站与花瓣 / 站酷同时跑，合并时直连在前且只占一半名额。网页版没有端口 ⇒ 如实报 `needs-browser`。

### 真实页面探针（`work/agent-browser/live-probe.json`，Playwright 无头 Chromium 跑**同一段注入脚本**）

| 站点 | 结果 |
|---|---|
| Dribbble `search/tea-packaging` | 原始 51 张 → 站点图 50，带 `/shots/` 原帖链接 42（无链接的按 `requireLink` 丢） |
| Packaging of the World `?s=tea` | 原始 69 → 68，全部带原帖链接 |
| Pinterest（未登录） | 13 → 12，`gatedCount=12` + 密码框 ⇒ 判为登录墙（走 #1088 提示） |
| The Dieline `?s=tea` | 「Checking your browser...」，`hashcash` 挑战标记命中 ⇒ 判为人机验证 |

## #1088 验证 / 登录墙提示

- `features/shared/research/agentBrowserWall.ts`：模块级待办 store（`requestBrowserWall` 挂待办并等回答、`answerBrowserWall`、`browserWallStore`）；调研 `signal` 中止 ⇒ 待办撤掉并按取消处理。
- `useAgentPanelToolModel`：`browserSites` 带上 `resolveWall: requestBrowserWall`。
- `browserSiteRun`：遇墙先 `agentBrowser.show` 亮窗口，再等「继续 / 取消 / 用户关窗（=继续）」三者先到者，结束必 `hide`；继续 ⇒ 重新提取；取消 ⇒ 本次运行这个站不再打扰。
- 界面 `pages/CanvasPage/AgentBrowserWallPrompt.tsx`（+ `.module.css`，按钮令牌同 `CanvasBrowserStates`）：画布舞台底部居中、工具条上方；按钮 **继续 / 显示窗口 / 取消**；多条只显示最早一条并注明「另有 N 个站点在等」；网页版无「显示窗口」；卡片带 `data-browser-occluder`（压到画布浏览器原生视图时原生视图让位）。
- 证据：`review/2026-11-13-agent-browser-evidence/before|after/*-wall.png`（1440×900、1024×700 × 明暗）；卡片 460×149 无溢出；点「显示窗口」⇒ `agent.show('pinterest','轻画 · Pinterest：请登录')`；点「继续」⇒ 调研收到 `continue`、卡片消失（`after/report-wall.json`）。

## #1089 画布浏览器「交给 Agent」

- 工具条预留位接 `CanvasBrowserAgentButton`（Lucide `Sparkles` + 文字，30px 高）。
- `pages/CanvasPage/browser/browserAgentHandoff.ts`：原生视图 `platform.browserView.extract('canvas', pageExtractScript({ maxImages: 40 }))`；iframe 退回 / 没有 `extract` / 超时 / 报错 / 认不出 ⇒ 只交地址 + 标题；状态条写明交了几张。
- `features/canvas/agentHandoff.ts`：`sendWebPageToAgent / subscribeWebPageAgentHandoff / takeWebPageAgentHandoff`（只留 http(s) 图、去重、截 12 张，同地址再交 = 替换）。`CanvasAgentHost` 收到即开对话窗。
- `useAgentAttachmentsController`：图片经 `researchSelectionActions(current.id).stage` 挂成**现有调研勾选 chip**（发送时才进参考台账，走原有 `useAgentResearchSelectionSend`），草稿末尾追加「参考网页「标题」 地址」；没有会话时先攒着。
- **顺手修的布局 bug**：挂上两行图片 chip 后输入框内容溢出盒子（面板 body `scrollHeight` 930 > 900）。有勾选图时输入框最小高度 174px，用户拖高的高度照旧生效；调研勾选同样受益。
- 证据：`before|after/*-browser.png`（工具条多出按钮）、`after/*-handoff.png`（点击后：对话窗打开、6 枚图片 chip、草稿行、状态条）；调用序列 `open → extract('canvas')`（`after/report-browser-handoff.json`）。

## 截图取证方式

真实 `<App/>`（共享存储服务 + Vite），只在 `src/platform/index.ts` 解析 `./web/index` 时换成一个 shim，给真实 web 平台加两个假端口：`browserView`（页面最上层的绝对定位块模拟原生视图，`extract` 返回固定快照）与 `agentBrowser`（只记命令）。Harness 存档：`work/harness-archive/agent-browser-harness/`；抓图脚本：`work/agent-browser/capture.mjs`。

## 门禁

- vitest 全量（串行四分片 `--shard=i/4 --maxWorkers=2`）：1657 + 1494 + 1410 + 1542 = **6103 通过，1 跳过（既有），0 失败**（740 个测试文件通过 + 1 跳过）。
- `npm run check`：全绿（tsc、eslint、depcruise 1289 模块 0 违规、架构反查、治理 428 登记、主题 182 个 CSS、对比度、壳层几何、文档索引 / 迁移、LibTV 目录、更新配置）。
- `npm run build`：通过。
- Rust：#1088 / #1089 未改 Rust；#1087 的 `work/bvcheck` 校验 crate `cargo check --target x86_64-pc-windows-msvc` 0 错 0 警告。

## Windows 真机待验清单

1. 隐藏 WebView2 窗口能渲染懒加载 / JS 页面（Dribbble、POTW 搜索页滚动后出图）。
2. 在画布浏览器里登录 Pinterest 后，Agent 窗口带同一份登录态。
3. 遇墙流程：窗口亮出 → 提示卡出现 → 「显示窗口」把窗口再拉到前台 → 「继续」重新提取 / 「取消」跳过 / 直接关窗算继续。
4. 完整 `src-tauri` 的 `cargo check`（`lib.rs` 接线在沙箱里只由校验 crate 覆盖，未在完整工程里编译）。
5. The Dieline 的 hashcash 挑战在真实 WebView2 里能否自动放行（无头 Chromium 被挡）。
6. Pinterest 登录态的选择器是手写 fixture（沙箱无账号），需真机核对。
7. 「交给 Agent」在原生视图里真的把页面图片送进输入框（`browser_view_extract` 返回、chip 缩略图加载、发送后进参考台账）。
