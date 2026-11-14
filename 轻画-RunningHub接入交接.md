# 轻画 · RunningHub 接入交接（2026-11-14 截止 `af6844d`）

> **这是一份"专项交接"，不是全局交接本。**
>
> 仓库里 `M0-对话交接.md` / `M1-对话交接.md` 已于 2026-09-21 **退休**（理由：手工交接本会和
> 《轻画-功能对账清单.md》冲突，让人误当现状）。所以本文**只讲 RunningHub 这一摊的工程上下文**：
> 做到哪、还差什么、哪些坑别再踩。
>
> - **状态真相源**：《轻画-功能对账清单.md》§五（编号 #1104–#1112）+ `ledger/按批记录-2026-11-b.md`。
> - **本文有效期**：截止提交 `af6844d`（RunningHub 的**代码**最后一次改动仍是 `ac7cc2d`，之后都是文档）。
>   之后任何代码/口径变化，**先改清单与调研文档，再改本文**。
> - **调研与证据**：《轻画-RunningHub工作流与三来源渠道调研.md》§二 / §五点五 / §九。

---

## 一、一句话现状

RunningHub 的**四种 API 已摸清并落了两层代码**（领域参数模型 + 平台 HTTP 对接，145 条单测）；
**还差界面与执行接线**（设置页「工作流/应用」入口、生成节点「来源」与动态参数区）。
真机"提交→轮询→收产物"**一次都没跑通**，原因是账号余额性质（见 §五），不是代码。

---

## 二、这轮提交干了什么（按顺序）

| 提交 | 内容 |
| --- | --- |
| `85bf07e` | 调研文档 + 新登记缺口 #1104–#1107（三条路径、两层参数口径、参考项目对照） |
| `ef676b1` | **领域层**：工作流参数模型 `workflowParams.ts` / `workflowParamValues.ts`（默认全隐藏、合并保留用户配置、uint32 种子、提交体） |
| `9e24d88` | 读通官方文档后的更正：`nodeInfoList` 官方定义、`/proxy` 原生 ComfyUI 代理、V2 query；`resultUrlsOf` 兼容 `url/outputUrl/fileUrl` |
| `b653df2` | **修缺陷 #1108**：RunningHub 渠道从"两把 Key（金额 / 币）"改成**单槽 `API Key`**（真机推翻旧口径） |
| `74207d4` | **平台层**：`runninghubWorkflow.ts`（拉参 / 拉应用 / 提交 / 上传 / 查任务）；**修缺陷 #1109**：19 位 `webappId` 精度；1014 文案 |
| `db614ba` | `fetchAppBundle`（填 id → 名称+封面+参数）；**修缺陷 #1110**：821 文案 + 错误码分支顺序（新增 `runninghubErrors.test.ts`） |
| `4c2b064` | GitHub 官方 `developer-kit` 核对（模型 registry / 价格 / llms.txt），新登记 #1111 |
| `ac7cc2d` | **四种 API 确认**（模型 / LLM / 应用 / 工作流）+ 积分与金额的准确口径，新登记 #1112 |
| `af6844d` | 本文（专项交接，用户要求）；同时把**国内站 API 市场页**核了一遍，新登记 **#1113**（免鉴权目录接口 / SKU id 坑，见 §五 15 与调研文档 §九 H） |

---

## 三、代码现在长什么样

### 新增（都已在 `architecture/module-governance.json` 登记）

| 文件 | 职责 | 测试 |
| --- | --- | --- |
| `src/domain/project/workflowParams.ts` | 工作流 JSON → 字段表（**默认全隐藏**）、重新拉取的合并、条目/模型 id 约定（`workflow:<id>`）、执行端（runninghub / comfyui-local） | `workflowParams.test.ts` 26 |
| `src/domain/project/workflowParamValues.ts` | 取值回落（空串=不下发）、必填只校验暴露字段、种子归一与随机、`nodeInfoList` 提交体、条目出图/出视频分类 | 同上文件 |
| `src/domain/project/workflowAppParams.ts` | `apiCallDemo` 的 `nodeInfoList` → 字段表（**默认全暴露**、中文名当标签、`fieldData` 取候选与多行）、`parseAppMeta`（名称 / 封面 / 加密标记） | `workflowAppParams.test.ts` 15 |
| `src/platform/channels/runninghubWorkflow.ts` | `getJsonApiFormat` 拉参、`apiCallDemo` 拉应用（含 bundle）、`task/openapi/create` 与 `ai-app/run` 提交、上传换 `fileName`、`openapi/v2/query` 查任务、`webappIdPayload` | `runninghubWorkflow.test.ts` 17 / `runninghubResults.test.ts` 5 / `runninghubErrors.test.ts` 6 |

### 改动

- `src/domain/project/protocol.ts`：`runninghub-api` **单令牌槽**（label/hint/note/docUrl 全部更新，note 里写明"标准模型只对企业级-共享 Key 开放"）。
- `src/platform/channels/runninghub.ts`：`resultUrlsOf`（三种产物地址形状）、`describeRhError` **导出**并重排分支（821 → 1014 → 812/余额 → 鉴权 → 1007）、`runApp()` 改用 `webappIdPayload`、头注释把"两把钥匙"改成"一把钥匙三种结算"。

### 快速自检

```powershell
npm run check                 # tsc / eslint / depcruise / 模块治理 / 文档四道闸门
npx vitest run src/domain/project/workflowParams.test.ts src/domain/project/workflowAppParams.test.ts `
  src/domain/project/protocol.test.ts src/platform/channels/runninghub.test.ts `
  src/platform/channels/runninghubWorkflow.test.ts src/platform/channels/runninghubResults.test.ts `
  src/platform/channels/runninghubErrors.test.ts      # 145/145
```

---

## 四、还要做什么（按建议顺序）

| # | 事项 | 状态 | 关键点 |
| --- | --- | --- | --- |
| **1104** | 工作流条目端到端 | 🧩 领域+平台已落地 | 缺：设置页「加工作流 → 拉参数 → 勾选暴露」与执行接线（`params.workflow` 下发、素材 upload 换 name、多产物落库） |
| **1105** | 生成节点「来源」切换（api / runninghub / cli） | 📝 未做（UI） | `data.source` 默认 `api`，**api 分支行为必须一字不变**；不新建节点类型 |
| **1106** | 参数「暴露 / 隐藏」面板 | 📝 待你定 UI 落点 | 我建议放**设置 → 渠道 → RunningHub → 条目详情**；字段需要 `enabled / label / group / 类型 / min·max·step / options / seed / bind_prompt` |
| **1107** | AI 应用参数如实化 | 🧩 领域+平台已落地 | 缺 UI；`runApp()` 里那四个写死字段名（`prompt / aspectRatio / resolution / duration`）应改成读字段表 |
| **1111** | 吃官方 `developer-kit`（500+ 模型 + 参数枚举 + CNY 参考价） | 📝 未做 | 生成脚本改吃 `model-registry.public.json`；`options` 自动填；**参考价不许当积分显示** |
| **1112** | 接第四种路线 `LLM` | 📝 未做 | 标准 OpenAI 兼容 ⇒ 走现有 `openai-compatible` 族，**不需要新适配器** |
| **1113** | 接国内站 API 市场的目录 / 搜索（`/api/sku/list`） | 📝 未做 | 免 Key；`STANDARD_MODEL 280 / WEBAPP 15 / WORKFLOW 18`，能按关键词搜；**市场 id 是 SKU id，`relatedDataId` 才是 `webappId`**（见 §五 15） |
| **1114** | 补齐 CLI 模板（`-i` 图生 / `rh app run`）+ 面板写明额度同源 | 📝 未做 | 官方 `rh` 还有 `app run --node/--file` 与 `image`/`video` 快捷菜单；但**没有 `workflow` 命令** ⇒ 工作流只能走 API。见 §五 16 |

**建议分组**：第三组=设置页（1104+1106+自检），第四组=生成节点（1105+1107 收尾），第五组=1111/1112。

---

## 五、必须注意的坑（都是这轮踩出来的）

1. **19 位 id 一律按字符串过一遍**。`1877265245566922753 > Number.MAX_SAFE_INTEGER`，`Number()` 后 `JSON.stringify` 会变成 `…800` —— 要么报"应用不存在"，要么**跑到别的应用上扣钱**。已有 `webappIdPayload()`；官方文档示例里写数字**是文档作者的 JSON 文本，不是 JS 运行时语义**，别照抄。官方 2026-05-09 也提交过 "allow larger node info ids"，同一个坑。
2. **两套错误形状**：`/task/openapi/*` 回 `{code, msg}`；`/openapi/v2/query` 回**顶层** `{errorCode, errorMessage}`（实测 `1004`），**没有** `code/msg`。只读一套会把"任务不存在"显示成一句空话。
3. **`describeRhError` 的分支顺序就是规格**：`821` 原文带"余额不足"会被 `812/余额` 正则吃掉；`1014` 原文带 "API Keys" 会被 `/key/i` 鉴权分支吃掉（eslint 都报"分支永远执行不到"）。**改顺序先跑 `runninghubErrors.test.ts`**。
4. **媒体字段两条路不能混**：工作流 / AI 应用的 IMAGE/VIDEO/AUDIO 吃 `task/openapi/upload` 回来的 **`fileName`**；标准模型端点路才是内联 data URI。（#691 的同类坑）
5. **默认值相反，别抄错**：自建工作流"拉回来是全部参数" ⇒ **默认全隐藏**；AI 应用"拉回来就是作者开放的" ⇒ **默认全暴露**。
6. **API 会强制重置 seed**：要固定 seed 必须把 seed 放进 `nodeInfoList`；不暴露 seed 就等于每次随机。
7. **免费积分不能用于 API**：`accountStatus` 的 `remainPoint` 可能显示还有分，但提交会回 `821 付费积分余额不足…免费积分不可用于 API 调用`。**界面上不能只显示积分数**。
8. **标准模型 API 只对企业级-共享 Key 开放**（`1014`）；消费级 Key 的可用面 = AI 应用 + 工作流 + LLM。
9. **计费口径**：**积分 = 运行时长**（自有算力，详情页带 `自部署` 徽标）；**金额 = 第三方模型调用费**（CNY）；**同一条工作流里可能两者同时发生**（市场卡片写「标准模型API调用费用+运行时长费用」）。`pricing.public.json` 全是 CNY，**不许当积分显示**；积分换算比例官方未公开。
10. **官方文档地址**：`https://www.runninghub.cn/runninghub-api-doc-cn/`（服务端渲染可读）；`/runninghub-api-doc/` 是 401、`/call-api/api-doc` 是 404 —— **别再试这两个**。插件 README 里那份 Notion 页抓不到正文。
11. **密钥纪律**：明文只在调用前注入，绝不入库；全历史扫描是发布前必做项。本轮用户曾在对话里贴过 Key ⇒ **收工提醒他轮换**（已提醒）。
12. **UI 门禁**：第三/四组都是界面改动，必须按 `AGENTS.md` 的 UI 门禁做 1440×900 / 1024×700 × 明暗四组截图 + 几何断言，不能只凭单测判绿。
13. **新文件先登记再写**：`architecture/module-governance.json` 要有职责 / owns / doesNotOwn / publicApi / test；新 TS ≤ **450 行**，超了**拆文件**（`workflowParams.ts` 就因此把"取值"拆到了 `workflowParamValues.ts`），**不要调高预算**。
14. **文档闸门**：新文档必须登记进《文档总索引.md》；根清单 ≤400 行、新文档 ≤800 行（`check-doc-size`）；改编号要重跑 `node scripts/ledger-index.mjs`。
15. **市场页上的 id 是 SKU id，不是 `webappId`**（2026-11-14 核对 `/call-api/search-api/webapp`）：`POST /api/sku/list` 回的是 **SKU**，`POST /api/sku/detail {id}` 里的 `relatedDataId` 才是真实的 `webappId` / `workflowId`（例：`2039234115011928065` → `2037457807762526209`）。用户从市场页抄 id 填进设置页**会填错**。这部目录**免登录免 Key**（`categoryType: STANDARD_MODEL|WEBAPP|WORKFLOW`，`search` 关键词真能用，`pageSize:999` 一次取全：280 / 15 / 18 条），所以设置页「加条目」可以做成搜索选择，而不是手填。**别用 `/api/search/model`、`/api/search/workflow`**（那是资源市场，传 WEBAPP 会被忽略）。
16. **CLI 不是"免费额度"，也跑不了工作流**（2026-11-14 核对官网 + GitHub）：中国官网**没有 CLI 文档**（`runninghub-api-doc-cn` 全文 0 次 "CLI"），唯一权威是 `HM-RunningHub/RH_CLI`（2026-06-01 后无新提交）。它能干的是 `check` / `model list·info·run`（`-i` 参考图可重复、`--param` 带类型转换）/ `image`·`video` 精选菜单（**不给 `--model` 会走交互菜单，非交互调用会挂住**）/ `app list·info·run`（`--node`、`--file`、`--instance-type`）；**没有 `workflow` 命令**。而且它解析的 Key 与渠道是**同一把**（`--api-key` > `RUNNINGHUB_API_KEY` > `%APPDATA%\rh\config.toml`）⇒ **同一本账**，别把它当第二份额度用。

---

## 六、真机验收还差什么

当前账号（`apiType: "NORMAL"`，消费级）四条路的真机门禁：

| 路线 | 只读接口 | 真跑 | 卡点 |
| --- | --- | --- | --- |
| 模型 API | ✅（但 `price-preview` 也 1014） | ❌ | `1014` 要企业级-共享 Key |
| LLM | ✅ `/v1/models` 200 | ❌ | `429 insufficient_quota` |
| AI 应用 | ✅ `apiCallDemo` 200 | ❌ | `821` 付费积分不足 |
| ComfyUI 工作流 | ✅ `getJsonApiFormat` 200 | ❌ | `821` 付费积分不足 |

**要真机验收，二选一**：给这个账号充**付费积分**，或换一把**企业级-共享 API Key**。
拿到之后按这个顺序验：① `create` 简易式（不传 nodeInfoList）跑通一条最便宜的；② 带 `nodeInfoList` 改一个提示词；③ 带参考图（upload → fileName）；④ 多产物；⑤ AI 应用一条。

---

## 七、还没实测的清单（别当结论用）

1. `/proxy/{apiKey}` 原生 ComfyUI 代理的**写入面**（`/prompt` 提交、`/history` 取结果、并发上限）—— 读面（`object_info` / `system_stats`）已实测 200；
2. `accessEncrypted: true` 的应用，`fieldValue` 是否要特殊处理；
3. 自建工作流在网页端"开放参数"的具体操作路径（只知道接口只回开放字段）；
4. 视频工作流真实耗时（决定超时是否要按条目可配）；
5. 余额为 0 的**企业级 Key** 打 `/task/openapi/create` 是否也是 `821`；
6. ~~关键词搜索：市场页是客户端渲染、没有公开 JSON 接口~~ —— **2026-11-14 已推翻**：搜索 / 分类走免 Key 的 `POST /api/sku/list`（见 §五 15 与调研文档 §九 H）。
7. **市场页的 SKU id ↔ `webappId` 映射**：`/api/sku/detail` 的 `relatedDataId` 看着就是 `webappId`，但**提交时到底吃 SKU id 还是 `relatedDataId` 没验过**（`apiCallDemo` 缺 Key 回 `500 UNKNOWN_ERROR`、假 Key 回 `332 USER_DOES_NOT_EXIST`，鉴权早于资源存在性检查，反推不出来）。拿到可用 Key 后第一件事就验这个，否则用户按市场页填 id 会稳定失败。
