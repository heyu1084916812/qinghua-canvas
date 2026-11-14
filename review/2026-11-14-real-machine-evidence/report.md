# 2026-11-14 · 真机验收证据（Windows 桌面壳）

对账编号：#1076 / #1076-1 / #1076-2 / #1086 / #1087 / #1088 / #1089 / #1094 / #1098 / #1037 / #1041 / #1040（#1088 结论见下）
环境：`src-tauri/target/debug/qinghua.exe`（dev 壳，加载 Vite `127.0.0.1:1420`），共享库 `sqlite-v2 / data-v2`（`/health` ok，version 8），
CDP 通过 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 开启（**仅本次验收用**，不是产品特性）。
系统代理 `127.0.0.1:10808` 开着。

## 一、站点点适配器（真实网络，走系统代理；node fetch）

`scripts/probe-live-sites.test.mjs`（gitignored 一次性探针）→ `searchFixedDesignSites(..., mode: 'image')`，查询 `['tea packaging design','茶叶包装设计']`，目标 24 张：

| 站 | 状态 | 条目 | 备注 |
| --- | --- | --- | --- |
| 花瓣 | ok | 4 | 链接为 `huaban.com/pins/…` |
| 站酷 | ok | 4 | |
| Cosmos | ok | 4 | 链接为 `cosmos.so/e/…` |
| The Dieline | ok | 4 | 走 WP REST（`wp-json/wp/v2/posts`） |
| BP&O | ok | 3 | 中文查询返回 `2B`（空），英文查询正常 |
| Lovely Package | ok | 4 | |
| Dribbble / POTW / Pinterest | needs-browser | 0 | 网页版预期；桌面壳里由 Agent 浏览器跑（见第二节） |

`usedSources = ['花瓣','站酷','Cosmos','The Dieline','BP&O','Lovely Package']`，`needsTavilyKey = false`（没花 Tavily 额度）。

**代理对照（同一批 URL，直连 vs 系统代理）**：直连 7 个目标里 6 个 200、`thedieline.com` **403**；走系统代理 **7/7 全 200**（Dieline 5081ms）。⇒ #1037「桌面请求跟随系统代理」在真实网络上成立。

**免 Key 网页调研（#1040 / #1041）**：`mode: 'web'` 发 5 个 `site:` 查询，全部 200（1210–1710ms），解析出 **2 条真实结果**（`pinterest.com/brandtheglobe/packaging-design-inspiration/`、`thedieline.com/`）⇒ 免 Key Bing 网页可用，但匿名请求结果偏少（与 #1041 的实测结论一致）。

**下载通道（#1098）**：`downloadResearchImageBytes` → BP&O 题图 **`.jpg` 84,411 B**、花瓣 `_fw658webp` **`.webp` 157,174 B**，两条都 `saved` ⇒ 不受图床 CORS 限制，按真实格式命名。

## 二、画布浏览器原生 webview（#1086，真机 IPC）

`scripts/probe-real-machine.test.mjs`（CDP 驱动运行中的壳，调用真实 Tauri 命令）：

| 命令 | 结果 |
| --- | --- |
| `browser_view_open(id='probe', url=thedieline.com, bounds=300,120,900,640)` | ok（`Window::add_child` 真建出系统 WebView 子视图） |
| `browser_view_extract(...)` | ok → `{"href":"https://thedieline.com/","title":"","images":0}`（eval 通道通；该页当场仍是空壳，内容层另说） |
| `browser_view_set_bounds / hide / show / close` | 全部 ok |

截图：`review/2026-11-14-real-machine-evidence/native-browser.png`（窗口被拿去做原生视图前后的一致性）。

## 三、Agent 后台浏览器（#1087，真机 IPC + 生产提取脚本）

同一探针，`agent_browser_load` 用 **`pageExtractScript(spec.extract)`（与 `browserSiteRun` 第 149 行同一写法）**，`scrollSteps` 取 spec 默认：

| 站 | 耗时 | 快照图 | 解析条目 | 墙 | 结论 |
| --- | --- | --- | --- | --- | --- |
| Packaging of the World | 15.2s | 69 | **8** | none | ✅ 首条 `Luma Socks: Sock Box Packaging Design` |
| Pinterest | 6.6s | 11 | **8** | none | ✅ 首条带 `/pin/` 链接 |
| Dribbble | 3.7s | 0 | **0** | none | ❌ 拿不到结果 |

**Dribbble 两次跑的差异（真机）**：第一次（未带 spec 选择器）返回 **challenge 墙**（被识别为 `challenge`）；带生产选择器那次 3.7s 返回 0 图 0 条、**没有**被判成墙。⇒ 真机 WebView2（普通桌面 UA + 该 profile 的 Cookie）上 Dribbble 的 WAF 形态与 2026-11-13 headless Chromium 实测（51 张图）不同，需要单独处理。已登记为 **#1101**。

截图/日志：本目录 + `%TEMP%\real-machine4.log`。

## 四、「交给 Agent」（#1089，真机 UI 点击）

`scripts/probe-real-handoff.test.mjs`：CDP 打开 `http://127.0.0.1:1420/canvas/proj_72ede1a3-…`（真库里的空白画布，**只读使用：不发消息、不改项目**）→ 点 `[data-canvas-browser-open]` → 地址栏输入 `https://packagingoftheworld.com/` 回车 → 点 `[data-canvas-browser-agent]`：

- 起始页 6 个快捷入口可见；浏览器图层正常打开
- 「交给 Agent」按钮存在且可用（未禁用）
- 点击后状态行：**「已交给 Agent：网页地址 + 1 张图片（发送前可在输入框里删掉不要的）。」**
- 输入区进入暂存态（`data-agent-research-staged`），暂存区内 **1 个 `img`**（图片 chip），草稿里含网页地址
- 全程 **0 条 pageerror / console error**

截图：`review/2026-11-14-real-machine-evidence/handoff.png`。

## 五、本轮**没有**验成的

| 编号 | 原因 |
| --- | --- |
| #1088（墙提示卡「继续 / 显示窗口 / 取消」全流程） | 需要一个「调研回合里真的撞墙」的场景。本轮 Dribbble 第二次没被判成墙、Pinterest 未登录也出了 8 条，没触发提示。识别逻辑本身在真机命中过一次（Dribbble challenge）。组件与等待流程仍只有单测 + 2026-11-13 假端口截图。 |
| #1061（品牌套件四项真实模型验收） | 需要配好的视觉模型 / 生图渠道与额度。 |
| #W4（设置里填 Tavily Key） | 需要真 Key。 |
| #S2（凭据「加密」写死口令） | 需要用户先选加固方案。 |
| #962（Pinterest 线上 OAuth） | 需要用户侧 Developer App 凭据。 |
