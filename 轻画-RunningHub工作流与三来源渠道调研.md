# 轻画 · RunningHub 工作流 / AI 应用 / 本机 CLI 三来源接入调研与落地方案

> **性质：调研 + 落地方案（建议稿）**，不构成排期承诺。要办的事已经登记进
> 《轻画-功能对账清单.md》§五（#1104–#1107），进度只认那张表。
>
> 起因（用户 2026-11-14 原话要点）：想做一个 RunningHub 节点，**更倾向做进现有的「生成节点」**，
> 通过**加一个渠道控制**（现在的 api 渠道 / RunningHub 工作流 / 以后把 codex、即梦等 CLI 也接进来，
> 用它们的额度拉模型、出图出视频出音频）；工作流的**可动参数**要能在后台页面里**暴露 / 隐藏**。
> 参考项目：<https://github.com/hero8152/Infinite-Canvas>。
>
> 调研方法：RunningHub 官方 CLI（`HM-RunningHub/RH_CLI`）源码、官方 ComfyUI 插件
> （`ComfyUI_RH_APICall` / `ComfyUI_RH_OpenAPI`）源码与 README、参考项目 Infinite-Canvas 的
> `main.py` 与前端源码逐条核对；轻画侧逐条对照现有代码。**凡未实测的都在 §6 单列，不当结论用。**

---

## 〇、一句话结论

RunningHub 侧真正需要的只有**三条接口路线**，轻画已经接了 1.5 条；
「参数暴露 / 隐藏」在 RunningHub 上是**两层东西**（AI 应用由作者在网页端开放字段；自建工作流没有这个概念，
得轻画自己拉全量参数再勾选），所以**不需要新建一种节点类型**，把来源做成生成节点上的一个选择项即可。

---

## 一、轻画现状（代码实况，2026-11-14 核对）

| 能力 | 落点 | 状态 |
| --- | --- | --- |
| RunningHub **标准模型 API**（`/openapi/v2/{endpoint}` → `/openapi/v2/query`） | `src/platform/channels/runninghub.ts` + `runninghubEndpoints/`（62 端点 / 49 模型，由官方目录生成） | 已接，真机验过（#368 / #363） |
| RunningHub **AI 应用**（`app:<webappId>` → `/task/openapi/ai-app/run`） | 同上 `runApp()` | 接了，但参数是**按字段名猜**：`prompt` / `aspectRatio` / `resolution` / `duration` 四个名字硬写（`runninghub.ts:702-713`），其余字段一律不下发 |
| **自建工作流**（`workflowId` + `/task/openapi/create`） | 无 | **没有**，代码里搜不到 `task/openapi/create` |
| 渠道 → 模型的选路 | `domain/project/generationRouting.ts` + `modelRouting.ts` + `routePlan.ts` | 已通（优先级 / 权重 / 多 Key 分组 / 候选轮询） |
| 本机 CLI 真起子进程 | `platform/channels/cliRun.ts`（+ `src-tauri/src/lib.rs`） | 能跑、能停、能吃本地媒体、能收多产物；**缺「用 CLI 的额度直接出图」的参数模板与产物回填**（#972 剩余项） |
| 生成节点的参数区 | `workbenches/canvas/panels/CreationPanel.tsx` + `domain/canvas/nodeSpecs/params.ts` | 参数**固定**（ratio/resolution/duration…），没有「按模型动态出控件」的能力 |

**关键结论：缺口不在「再写一个 RunningHub 适配器」，而在**
① 工作流那条 HTTP 路没接；② 参数是写死的，无法按条目动态渲染；③ 生成节点上没地方选「来源」。

---

## 二、RunningHub 侧到底有几条路（逐条核对过的接口）

基址：`https://www.runninghub.cn`（国际站 `https://www.runninghub.ai`，路径一致）。
所有 Key 都走请求体 / query 的 `apiKey`（官方 CLI 另有 `Authorization: Bearer`，两条都认）。

| 用途 | 方法与路径 | 请求体要点 | 响应要点 |
| --- | --- | --- | --- |
| 校验 Key / 读余额 | `POST /uc/openapi/accountStatus` | `{apikey}` | `code:0`；`data.remainCoins`（RH 币）/ 金额余额 |
| **标准模型**（结算见 §五点五 E） | `POST /openapi/v2/{endpoint}` | 提示词 + 媒体字段 + 档位，见目录 | `{code:0, data.taskId}` |
| 轮询（标准模型） | `POST /openapi/v2/query` | `{apiKey, taskId}` | `code`：`804` 运行 / `813` 排队 / `805` 失败 / `0` 完成；`results[]` |
| **AI 应用列表** | `POST /openapi/v2/aiapp/list` | `{current,size,sort}` | `data.records[]`（`invokeExample` 里有 `/run/ai-app/<id>`） |
| **AI 应用可改字段** | `GET /api/webapp/apiCallDemo?apiKey=&webappId=` | — | `data.nodeInfoList[]`（**只有作者开放过的字段**） |
| **AI 应用提交** | `POST /task/openapi/ai-app/run` | `{apiKey, webappId, nodeInfoList, instanceType?}` | `data.taskId`、`data.promptTips`（含 `node_errors` 即工作流校验失败） |
| **工作流 JSON（Api 格式）** | `POST /api/openapi/getJsonApiFormat` | `{apiKey, workflowId}` | `data.prompt` = **整份工作流 JSON 的字符串** → 每个节点的 `inputs` 就是「所有可动参数」 |
| **工作流提交** | `POST /task/openapi/create` | `{apiKey, workflowId, nodeInfoList, addMetadata?, instanceType?}` | `data.taskId` |
| 任务状态 | `POST /task/openapi/status` | `{apiKey, taskId}` | 状态码同上 |
| 取结果 | `POST /task/openapi/outputs` | `{apiKey, taskId}` | `data[]`：`{url / outputUrl, outputType, text}`，**可能多份** |
| 上传素材 | `POST /task/openapi/upload`（multipart） | `apiKey`、`fileType=input`、`file` | `data.fileName` —— **工作流 / AI 应用的媒体字段吃的是这个 fileName，不是 URL、不是 data URI** |

`nodeInfoList` 的元素形状（两个官方实现一致）：
`{ nodeId, fieldName, fieldValue, fieldType? }`；`fieldType` 取值见过 `TEXT` / `IMAGE` / `VIDEO` / `AUDIO` / `NUMBER` / `BOOLEAN`。
`instanceType: "plus"` = 4090 48G 更高规格实例（`ComfyUI_RH_APICall` 里就是这么传的）。

> 依据：`RH_CLI/src/rh_cli/app/{client.py,nodes.py,http.py}`、
> `ComfyUI_RH_APICall/RH_ExecuteNode.py:327,1800,1868,1956,2047`、
> 参考项目 `Infinite-Canvas/main.py:12588-12690, 12760-12800`。三份独立实现互相印证。

### 2.1 「参数暴露 / 隐藏」在 RunningHub 上是两件不同的事

| 路线 | 谁能决定"哪些参数可动" | 轻画要做什么 |
| --- | --- | --- |
| **AI 应用**（`webappId`） | **作者在 RunningHub 网页端建应用时勾选的「开放参数」**。`apiCallDemo` 只回这些，别的一律拿不到 | 只需**如实渲染**拿到的那几个字段，不要自己发明参数名 |
| **自建工作流**（`workflowId`） | **没有任何"暴露"机制** —— `getJsonApiFormat` 把整份工作流的每个 `inputs` 都给你 | 必须自己做「发现 → 全部默认隐藏 → 用户勾选暴露」这层面板 |

参考项目 Infinite-Canvas 把这两层都做了：
- 应用：`rh_apps[].fields[]`，每个字段落成
  `{id:"<nodeId>::<fieldName>", nodeId, fieldName, fieldType, fieldValue, label, enabled, group, note, options[], min, max, step, random_enabled, imageOrder, required, sourceFromUpstream}`；
- 工作流：`workflows/*.json` + 同名 `*.config.json` 侧车文件声明暴露哪些 `{node, input, name, type, default, min, max, step, options, bind_prompt}`；
  拉全量参数时**默认 `enabled: false`**（`main.py` 的 `runninghub_collect_workflow_fields`），用户勾一个才暴露一个。
- 它连 ComfyUI 工作流 JSON 里"链接值"（`["<nodeId>", slot]`）都会跳过，不当参数 —— 这条轻画照抄。

---

## 三、参考项目对照（可以直接借鉴什么）

| 项目 | 星标 | 与本需求的关系 | 值得抄 / 不值得抄 |
| --- | --- | --- | --- |
| `hero8152/Infinite-Canvas` | 3184 | **用户指定的参考**：无限画布 + ComfyUI/API + RunningHub 工作流/AI 应用 + CLI(Codex/即梦/Gemini) + Chrome 插件 | 抄：**字段模型**（上面的 fields 结构）、两层暴露策略、`app:`/`workflow:` 双入口、素材先 upload 换 fileName、seed 归一 32 位。**别抄**：`main.py` 88 万字节单文件（前端 96 万字节单 js），轻画是分层架构，照抄会把 depcruise 门禁全撞红 |
| `HM-RunningHub/RH_CLI` | 32 | **官方 CLI**：`rh check` / `rh image|video` / `rh model run` / `rh app run` | 抄：端点与错误码映射、`requiredDefaults`（必填+有默认值的补齐）、"没有可改节点 = 先在网页端成功跑一次"的文案。轻画适配器已按它实现过一轮 |
| `HM-RunningHub/ComfyUI_RH_APICall` | 304 | 官方 **工作流** 插件 | 抄：`/task/openapi/create` 请求体、`getJsonApiFormat` 拉参数与节点数、WebSocket 断线转 HTTP 轮询。别抄：ComfyUI 节点形态（轻画不是 ComfyUI 宿主） |
| `HM-RunningHub/ComfyUI_RH_OpenAPI` | 164 | 官方标准模型 API 的 ComfyUI 实现（551 节点） | 抄：模型注册表思路（轻画已用官方 `capabilities.json` 生成 62 端点目录） |
| `Work-Fisher/AIFISHER` | 354 | 最像轻画的竞品：本地画布 + 本地 ComfyUI + RunningHub + "API 工作流导入与参数配置" | 看：它的「API 工作流导入 + 参数配置」入口形态（Electron + React）。闭源主体，无可抄代码 |
| `WLDFC/lumen-light` | 28 | 无限画布 + ComfyUI（本地/RunningHub 云端）+ agent | 看：同赛道形态，不必细读 |
| `colorAi/RunningHub-AI-Client`、`XIAOTsune/PixelRunner`、`liangtongt/RH_Helper`、`jacky9920084/runninghub-nodes-database`（9633+ 节点参数库） | 108 / 87 / 103 / 14 | 第三方客户端 / PS 插件 / 节点参数库 | 参数库那个可以当"字段名 → 中文标签"的兜底字典（可选，先不做） |

---

## 四、落地方案：做进生成节点，不新建节点类型

### 4.1 概念：把节点上的「渠道」升级成「来源 → 条目 → 参数」三层

```
来源 Source       api（现有 HTTP 渠道） | runninghub（应用/工作流） | cli（本机 CLI）
   └ 条目 Entry   渠道 id（现有）        | app:<webappId> / workflow:<workflowId> | 工具 id（codex/即梦/gemini/rh）
        └ 参数 Params 现有固定参数       | 暴露字段（动态渲染）                    | 现有模板占位符
```

**为什么这样切**：现有渠道抽象（`Channel` + `ProtocolDefinition.family` + 适配器 + `RoutePlan`）已经把
「多 Key、优先级、轮询、错误归一、取消、日志」全部解决。新来源只要能被表达成**同一渠道里的一条模型条目**，
就自动继承这些能力 —— 这与仓库既有口径一致（`ESSENTIALS.md`「技能不是新机制，是既有链路的参数化」）。
`app:<id>` 已经是这么做的（`runninghub.ts` 的 `APP_PREFIX`），新工作流条目就是 `workflow:<id>`，同构。

### 4.2 领域层新增（纯函数，先写测试）

| 文件 | 内容 |
| --- | --- |
| `src/domain/project/workflowParams.ts` | `WorkflowParamField` 类型（对齐 §2.1 的字段结构，剪掉用不上的）；`parseWorkflowJsonToFields()`（吃 `getJsonApiFormat` 的 `data.prompt`，跳过链接值，全默认 `enabled:false`）；`toNodeInfoList()`（只把 `enabled` 的字段拼成提交体，值统一转字符串）；`normalizeSeed()`（32 位）；`fieldValueSummary()`（日志/结果卡用的脱敏摘要） |
| `src/domain/project/generationSource.ts` | `GenerationSource = 'api' \| 'runninghub' \| 'cli'`；`sourceOfModel(model)`（按 `app:` / `workflow:` / 工具前缀反推）；`entryIdOfModel()`；`entryKindOfModel()` |
| `src/domain/canvas/nodeSpecs/params.ts` | 增一路：`workflow` 条目下把 `data.workflowParams` 原样带上（`params.workflow = { entryId, kind, fields }`），**其余固定参数照旧**（工作流里没人要 ratio 就不发，别塞） |

### 4.3 平台层（适配器）

`src/platform/channels/runninghub.ts` 增加 `workflow:` 分支（与现有 `app:` 分支并列）：

1. 取条目参数 schema（见 4.4 的存储）→ 校验必填项；
2. 每个 `IMAGE` / `VIDEO` / `AUDIO` 字段：素材 `prepareModelImageInput() → /task/openapi/upload → fileName` 写入 `fieldValue`
   （**端点路要内联 data URI、应用/工作流路要 fileName，两条不能混**，这条以前已经踩过一次，见 #691）；
3. `POST /task/openapi/create`（`addMetadata: true`，必要时 `instanceType`）；
4. 轮询沿用现有 `waitForTask()`；`results[]` 多份产物沿用现有 `thumbOrder` 逻辑（#972 第十八轮已做）。

### 4.4 存储：**不动 Dexie schema**

参数 schema 与条目清单都挂在既有 `presets` 表（对齐「技能不是新机制」那次的做法）：

| 键 | 值 |
| --- | --- |
| `presets/rh:entries:<channelId>` | `[{ kind:'app'\|'workflow', id, title, note, thumbnail?, fields: WorkflowParamField[], updatedAt }]` |
| `presets/rh:defaults:<channelId>:<entryId>` | 最近一次运行的字段值（"上次用的参数"，节点新建时据此预填） |

> 不建议把 schema 塞进 `Channel.models[].` —— `ModelCapability` 是**能力声明**（image/video/chat + 输入类型），
> 塞参数 schema 会让"渠道能不能跑"和"参数长什么样"两件事耦合，`channelIsRoutable` 那类判据也会被污染。

### 4.5 生成节点 UI（**涉及 UI，必须走 UI 门禁**）

在 `CreationPanel.tsx` 现有参数区之上加一行「**来源**」，其余不动：

- 来源选中 `api` → 现在的行为一字不变（零回归风险，默认值仍是 `api`）；
- 选中 `runninghub` → 模型下拉换成「AI 应用 / 工作流」两段清单，选中条目后**在参数区下方展开该条目的暴露字段**：
  - `TEXT` → 单行 / 多行（`bind_prompt` 的那个字段跟节点提示词双向同步）；
  - `NUMBER` → 数字输入 + `min/max/step` + 可选「随机」（种子类字段用）；
  - `BOOLEAN` → 开关；`options[]` 非空 → 下拉；
  - `IMAGE` / `VIDEO` / `AUDIO` → 走现有素材缩略图行（含「用上游」）；
  - **隐藏字段不出现在节点上**，也不下发（服务端工作流自己用默认值）。
- 「哪些字段暴露」这件事放在**后台（设置页）**而不是节点上（用户原话就是"在后台页面里暴露和隐藏"）：
  设置 → 渠道 → RunningHub → 条目详情 → 参数面板（勾选 / 改名 / 分组 / 类型 / 范围 / 选项 / 顺序）。
  节点上只呈现已暴露的字段。理由：节点空间有限，且暴露规则是"一次性配置、长期复用"。

### 4.6 执行链路（要改的地方只有两处）

1. `collectInputs` / `toRunRequest`（`nodeSpecs/generation.ts`）：把 `data.workflowParams` 并进 `params.workflow`；
2. `generationClient` / 执行器：`RunRequest.params.workflow` 原样透传给适配器（现有 `params` 已经是 `Record<string, unknown>`，无需改契约）。

`resolveGenerationTarget()` **不需要改**：`app:` / `workflow:` 都是 RunningHub 渠道里的模型条目，仍按现有优先级选路。

### 4.7 与现有「路由 / 分组 / 停止」的边界

- 工作流条目**不参与** `modelMap` 映射（它是条目 id，不是上游模型名）；
- 一条 RunningHub 渠道可以同时挂标准模型、AI 应用、工作流三类条目；**计费别再按"两本账 = 两条路"讲**：V2 query 的 `usage` 里 `consumeMoney / consumeCoins / thirdPartyConsumeMoney / chargedPoint + settleMode` 同时回，实际结算看账号/Key 类型（见 §五点五 E）；错误码 `812` 的文案已按旧口径翻译过（#363），收敛口径时一并核对；
- 停止 = 现有 `AbortSignal`（中止轮询即可；**RunningHub 侧任务不会因此取消**，要如实提示"本地已停止、云端仍在跑/仍计费"——这一条以前在别处没写清，属于要补的文案）。

---

## 五、CLI 来源（codex / 即梦 / gemini / rh）：复用什么、缺什么

现有 `cliRun.ts` 已经解决最难的几件事：真起子进程（不过 shell、参数是数组）、可见窗口登录、
`cli-in` 受控媒体导出（hash → 本地路径 → `{image}` / `{video}` 占位符）、进程树终止、多产物读回（#308 / #972 各轮）。

**仍缺的**（这就是"用它们的额度出图"的最后一公里）：
1. **产物回填**：CLI 输出目录里的新文件要按 hash 进 `assets`、落成生成节点的产物（现在只支持 stdout 里的路径 / 指定 `-o`）；
2. **每个工具的出图参数模板**：Codex（`gpt-image-2` skill）、即梦（无官方 CLI，走交互式，需可见窗口）、Gemini、`rh`（`rh image --model N -p …`）各自一条；
3. **音频产物**：现有 `GeneratedAsset` 只有 image/video，音频要么补 MIME 白名单，要么先只允许 mp3/wav 落素材；
4. **额度读取**：只有 `rh --json check` 真正能读余额（#367 实测），其余工具如实说"这条工具没有可查命令"。

→ 建议：**CLI 来源先只做「来源可选 + 模板跑通 + 产物回填」**，不追求一次把四个工具全做齐。

---

## 五点五、官方文档核对结果（2026-11-14 第二轮，用户给了可读入口）

> 第一轮我抓不到文档正文（SPA + Notion），只能靠官方源码互证。用户给了两个地址后**正文全部读到了**：
>
> - 文档站：`https://www.runninghub.cn/runninghub-api-doc-cn/`（导航 480 个链接，正文服务端渲染）
> - API 详情页：`https://www.runninghub.cn/call-api/api-detail/2120340341193793538?apiType=4`
>
> 下面每一条都能在上述文档里点开核对（页 id 我写在括号里）。

### A. 文档结构（能直接对上的页面）

| 页面 | 路径 | 我用来定什么 |
| --- | --- | --- |
| 开始 | `/runninghub-api-doc-cn/doc-8287334` | Key 类型限制（消费级 Key 需**基础版及以上会员**；企业级共享/独占不受限） |
| 关于 nodeInfoList | `…/doc-8287336` | **nodeId / fieldName / fieldValue 的官方定义**（下面 B 节） |
| 原生 ComfyUI 接口支持 | `…/doc-8287337` | **`/proxy/{apiKey}` 与 `/proxy-plus/{apiKey}`**（把云端当本地 ComfyUI 用，见 C 节） |
| 接口错误码说明 | `…/doc-8287338` | 错误码含义 |
| 工作流完整接入示例 | `…/doc-8287342` | 官方给的完整跑通流程（含结果字段形状） |
| AI 应用完整接入示例 | `…/doc-8287339`、`…/doc-8287340`（高阶） | 应用接入与进度显示 |
| 发起 ComfyUI 任务 1-简易 | `…/api-425749012` | `POST /task/openapi/create`，**只传 apiKey + workflowId = 不改任何参数直接跑** |
| 发起 ComfyUI 任务 2-高级 | `…/api-425749013` | 加 `nodeInfoList` + `instanceType` / `retainSeconds` / `usePersonalQueue` / `webhookUrl` |
| 获取工作流 Json | `…/api-425749014` | `POST /api/openapi/getJsonApiFormat`，`data.prompt` = 工作流 JSON **字符串**（官方样例带 `_meta.title`） |
| 发起 AI 应用任务 | `…/api-425749010` | `POST /task/openapi/ai-app/run`（`webappId` 是**数字**） |
| 获取 AI 应用 API 调用示例 | `…/api-425749011` | **`apiCallDemo` 的真实返回体**（这是第一轮缺的那块，见 D 节） |
| 查询任务生成结果 V2 | `…/api-425767306` | **`POST /openapi/v2/query`：一个接口查所有任务类型**（见 E 节） |
| 查询任务状态 / 生成结果 | `…/api-425749003`、`…/api-425749004` | 两者**都标了「将废弃」**，新代码别再用 |
| 文件上传 | `…/api-425749007` | `POST /task/openapi/upload`，回 `{fileName, fileType}` |

### B. nodeInfoList 的官方定义（这条第一轮只能靠源码猜）

- 工作流界面上每个节点右上角的数字 = **nodeId**；
- 节点在 **api_format** 里的 `inputs` 的 key = **fieldName**，值 = **fieldValue**；
- 官方示例里 `fieldValue` **一律是字符串**（`"nodeId": "6"`、`"fieldValue": "1231231"`）；
- **`[]` 包裹的值一般是连线，官方明说"不建议修改"**（与我的 `isWorkflowLinkValue` 一致）；
- 找不到的 `fieldName` = **纯前端逻辑**（如 `control_after_generate`、group 相关），API 里根本不存在；
- ⚠️ **「API 调用会强制重置 seed 值」**，要保住 seed 必须把它放进 `nodeInfoList`；
- 图片两条路：① 自建图床 + `LoadImageFromUrl` 节点（**直接吃公网 URL**）；② 上传后把 `fileName` 写进 `LoadImage`。

### C. 一个第一轮完全没发现的入口：原生 ComfyUI 代理

官方原话：`https://www.runninghub.cn/proxy/{你的apiKey}`（24G）与 `/proxy-plus/{你的apiKey}`（48G），
**功能等同本地 `http://127.0.0.1:8188`**，已适配 EasyAI / SillyTavern / Krita 插件。

对轻画的意义很大：**「工作流渠道」的两种执行端可以共用一套协议**——
本地 ComfyUI 用 `http://127.0.0.1:8188`，云端用 `/proxy/{key}`，都是原生 ComfyUI API
（`POST /prompt`、`/history/{id}`、`/object_info`）。这比"云端走 task/openapi/*、本地走 ComfyUI"两套实现省一半代码，
而且 `/object_info` 能拿到**下拉候选与数值范围**，正好补上"工作流 JSON 推不出 options"的短板。
注意它是个**新方向**（第一轮没核到），要先实测再决定是否采用，别直接当结论写进代码。

### D. `apiCallDemo` 的真实返回体（第一轮列的「未实测第 1 条」已解决）

`GET /api/webapp/apiCallDemo?apiKey=&webappId=` → `data` 里有：

| 字段 | 内容 |
| --- | --- |
| `nodeInfoList[]` | 每个可改参数一项：`nodeId`、**`nodeName`**（如 `LoadImage` / `RH_Translator`）、`fieldName`、`fieldValue`、**`fieldType`**（`IMAGE` / `LIST` / `STRING`…）、**`description`**（中文名，如「上传图像」「图像编辑文本输入框」）、`descriptionEn`、**`fieldData`**（字符串化 JSON） |
| `fieldData` 三种形状 | IMAGE：`'[["a.png","b.png","example.png"], {"image_upload": true}]'`；LIST：`'[{"name","index","description"},…,{"default":…,"description":"忽略"}]'`；STRING：`'["STRING", {"default":"", "multiline": true}]'` |
| `webappName` | 应用名 |
| `covers[]` | 示例图（`url` / `thumbnailUri` / 宽高）→ **可直接当下拉里的缩略图** |
| `tags[]` / `statisticsInfo` | 标签与用量（`useCount` / `likeCount`…） |
| `curl` | 官方给的完整调用示例 |

⇒ 结论：**AI 应用的参数根本不用猜**——有中文名、有候选列表、有「多行文本」标记、有缩略图；
`LIST` 里那条 `{"default":…, "description":"忽略"}` 是哨兵项，必须跳过。

### E. 任务查询与计费：V2 一个接口管全部

`POST /openapi/v2/query`（**查询任务生成结果 V2**）body 只有 `{taskId}`，Header 带 Bearer：

```json
{ "taskId": "…", "status": "SUCCESS", "errorCode": "", "errorMessage": "",
  "results": [{ "url": "…", "outputType": "jpg" }], "clientId": "", "promptTips": "",
  "usage": { "taskCostTime": "12", "consumeMoney": null, "consumeCoins": null,
             "thirdPartyConsumeMoney": null, "settleMode": "POINT", "chargedPoint": "1.28" },
  "taskUsageList": [ … ] }
```

⇒ 两个修正：

1. **「工作流扣金额、AI 应用扣币」这个说法过于绝对**。真实情况是同一个任务结果里
   `consumeMoney`（金额）/ `consumeCoins`（币）/ `thirdPartyConsumeMoney`（第三方成本）/
   `chargedPoint`（积分）+ `settleMode`（如 `POINT`）**同时存在**，实际按账号/Key 类型结算。
   旧记录里"两把 Key = 两本账"的描述要按这条收敛（轻画现有适配器已经用 V2 query，方向是对的）。
2. 旧的 `/task/openapi/status`、`/task/openapi/outputs` **都标注「将废弃」**，且回的是
   `[{fileUrl, fileType, nodeId}]` 形状 —— 轻画已经改用 V2，但**产物解析要同时兼容
   `url` / `outputUrl` / `fileUrl`**（已按这条补了 `resultUrlsOf` + 5 条单测）。

### F. 真机只读实测（2026-11-14，用户提供 Key，**没花一分钱**）

| 探测 | 结果 | 结论 |
| --- | --- | --- |
| `POST /uc/openapi/accountStatus` | `{apiType:"NORMAL", remainCoins:"84", remainPoint:30.000, remainMoney:null, currentTaskCounts:"0"}` | **金额 / RH 币 / 积分是同一个账号的账**；`apiType` 才是"账号形态"（个人 `NORMAL` / 企业共享 / 独占）。⇒ 用户说的"金额和积分合并了"成立 |
| `GET /api/webapp/apiCallDemo?webappId=…` | `data` 键 = `descriptionEn, curl, accessEncrypted, webappName, description, statisticsInfo, nodeInfoList, covers, tags`；`nodeInfoList[0]` = `{nodeId:"122", nodeName:"SeargePromptText", fieldName:"prompt", fieldValue:"…", fieldType:"STRING", fieldData:'["STRING", {"default":"", "multiline":true}]', description:"prompt提示词"}` | **§五点五 D 的字段全部实测成立**；`fieldData` 用来判控件（多行文本等） |
| `POST /openapi/v2/aiapp/list` | 回 85 460 个应用；`invokeExample` 里的提交地址是 **`POST /openapi/v2/run/ai-app/{id}`** | 官方新形态（v2 run 路由）已经在用它自己的示例里 |
| `GET /openapi/v2/run/ai-app/{id}`、`GET /openapi/v2/run/workflow/{id}` | 都回 `{code:301, msg:"PARAMS_INVALID"}` | **两条 v2 run 路由都真实存在**（GET 不该被接受，所以是参数错而非 404）⇒ "两种 API 形态"确认：旧 `/task/openapi/*` + 新 `/openapi/v2/run/*` |
| `POST /api/openapi/getJsonApiFormat` | 别人的公共 workflowId 也能拿到整份工作流 JSON | 拉参数不需要"自己的"工作流，但**提交**必须是自己账号里能跑的那条 |
| `POST /openapi/v2/query {taskId:"1"}` | `{taskId:"1", status:"", errorCode:"1004", errorMessage:"Task not found…", results:null, promptTips:"", failedReason:{}}` | **错误在顶层 `errorCode/errorMessage`**，没有 `code/msg`；解析必须按这条 |
| `GET /proxy/{apiKey}/object_info` | **HTTP 200**，拿到完整节点定义（`KSampler.input.required.seed` 带 `min/max/control_after_generate`、`tooltip`…） | **原生 ComfyUI 代理真的可用**；这是"下拉候选 / 数值范围"的权威来源 |
| `GET /proxy/{apiKey}/system_stats` | `comfyui_version 0.3.27`、`pytorch 2.5.1+cu124`、`RTX 4090`(24G) | 代理后面是真机 ComfyUI，不是桩 |
### G. 第三轮：计价的两种单位 + Key 等级门槛（2026-11-14，同一把消费级 Key）

| 探测 | 结果 | 结论 |
| --- | --- | --- |
| `POST /openapi/v2/price-preview/{route}`（官方「模型 API 价格预估」，页 `api-454850620`） | 返回体同时有 **`estimatedPrice`** 与 **`estimatedPoint`**（另有 `currency`、`freeLimit*`、`isFreeThisCall`） | **报价本身就有两种单位**：金额（闭源/第三方模型按次计费）与积分（自有算力跑的开源模型）—— 与用户说的"积分跑自部署、金额跑闭源"**一致** |
| 同接口打 `rhart-image-n-pro/text-to-image` / `rhart-image-g-2-official/...` / `rhart-video-v3.1-fast/...` | 全部 `errorCode 1014`：**"Standard Model API is restricted to Enterprise-Shared API Keys only"** | **标准模型 API 只对企业级-共享 Key 开放**；消费级（`apiType: NORMAL`）Key 只能走 **AI 应用 / 工作流** |
| `POST /openapi/v2/models` | `errorCode 1001 Invalid URL` | 没有"模型目录"这个公开接口（目录要靠官方文档/插件里的 `capabilities.json`） |

⇒ 三条产品口径因此要写进界面：

1. **一条渠道一个 Key**（#1108）；
2. **标准模型只对企业级-共享 Key 开放**（1014 已在适配器里翻成人话）；
3. **消费级 Key 的可用面 = AI 应用 + 工作流**，所以"工作流渠道"对这类用户不是锦上添花，而是**唯一能用自定义工作流的路**。
### H. 第四轮：真跑一次被"免费积分"挡住（2026-11-14，用户已授权扣费）

正式提交一条最便宜的 AI 应用（`webappId=1877265245566922753`，只有一个 `prompt` 字段），
以及一条工作流提交（`/task/openapi/create`），**两条都回同一句**：

```json
{"code":821,"msg":"付费积分余额不足，消费级 API 调用仅支持使用付费积分，免费积分不可用于 API 调用"}
```

而 `accountStatus` 里明明写着 `remainPoint: 30.000`。⇒ **那 30 分是"免费积分"，API 调用一分都不能用**。

| 结论 | 影响 |
| --- | --- |
| 余额有三种：`remainMoney`（金额）/ `remainCoins`（RH 币）/ `remainPoint`（积分），而**积分还分免费与付费** | 界面不能只显示"还有 30 分"，否则用户会一直以为能跑 |
| `code 821` 是消费级 Key 最常见的拦路虎 | 适配器已把它翻成「API 调用只吃付费积分，免费积分不能用，去充值」 |
| 真机"提交→轮询→收产物"**仍然没有跑通**（钱不够，不是代码问题） | #1104 的验收判据仍是"真机跑出一条"，等充值后再补 |

**要真机验收需要**：给这个账号充一点**付费积分**（或换一把企业级-共享 Key）。
在那之前，提交链路的正确性只能靠官方文档 + 官方插件源码 + 假网络单测保证 —— 这条要如实写在账本里。

**对方案的影响（两处）**：

1. **渠道令牌槽从 2 个改回 1 个**（对账 #1108，已修）：`runninghub-api` 只声明一个 `API Key`，
   界面上不再出现"账户余额 Key（金额）/ RH 币 Key"两行；错误文案里的"别混用两把 Key"一并改掉。
2. **工作流渠道的执行端多了一条更优选择**：云端 `/proxy/{apiKey}` + 本地 `127.0.0.1:8188`
   都是原生 ComfyUI API，能用 `/object_info` 拿到每个参数的**候选集与范围**（工作流 JSON 里没有这些），
   比走 `getJsonApiFormat` + 人工配 options 精确得多。**仍未验证**：`/prompt` 提交、`/history` 取结果、
   并发与计费口径（见 §六）。

---

## 六、仍未实测的项（**不许当结论用**）

> 第一轮列的 5 条已有 2 条被官方文档解决（`apiCallDemo` 的字段、`fieldValue` 的类型），
> 见 §五点五 D / B。下面剩 3 条 + 2 条新增，仍必须真机或真人确认。

| 项 | 现状 | 怎么补 |
| --- | --- | --- |
| 自建工作流的「AI 应用开放参数」网页流程细节 | 只知道 `apiCallDemo` 只回开放字段；网页端具体在哪个页面勾 | 登录 RunningHub → 建一个 AI 应用走一遍，截图存档 |
| 工作流提交的真实耗时 / 超时 | 官方文档提示视频任务可能较长（`taskCostTime` 单位是秒） | 真跑一条视频工作流，决定超时阈值是否要按条目可配 |
| 余额为 0 时的行为 | 已知标准模型报 `812 企业版余额不足`；`create` 是否同一错误码未验 | 用余额为 0 的 Key 打一次 `/task/openapi/create` |
| 原生 ComfyUI 代理（`/proxy/{key}`）**写入面** | **读面已实测通过**（`/object_info`、`/system_stats` 都是 200，见 §五点五 F）；**写面（`/prompt` 提交、`/history` 取结果、并发上限、与 WebSocket 推流）没验** | 用一条最小工作流打一次 `/prompt` + `/history`，再决定 P1 走 `task/openapi/create` 还是这条（若通，云端与本地 ComfyUI 可共用一套协议） |
| **新增**：`apiCallDemo` 的 `accessEncrypted: true` 应用 | 示例里是 `false`；加密应用的 `fieldValue` 是否要特殊处理未知 | 找一个加密应用看返回体 |

**可读的官方文档入口**（2026-11-14 起可读；第一轮我抓不到是因为用错了地址）：
- **中文文档站（正文可读）**：`https://www.runninghub.cn/runninghub-api-doc-cn/`
- API 详情示例页：`https://www.runninghub.cn/call-api/api-detail/2120340341193793538?apiType=4`
- 标准模型 API 落地页：`https://www.runninghub.cn/call-api/standard-api`
- 官方插件 README 里另有一份 Notion 文档（JS 渲染，抓不到正文）：`https://gold-spleen-bf1.notion.site/RunningHub-API-1432ece0cf5f8026aaa8e4b9190f6f8e`
- 取 Key：`https://www.runninghub.cn/enterprise-api/sharedApi`
- 调用记录 / 账单：`https://www.runninghub.cn/call-api/call-record`

---

## 七、分期建议（每期都有可红的验收判据）

| 期 | 内容 | 验收判据（要能变红） |
| --- | --- | --- |
| **P1 工作流条目能跑** | 领域 `workflowParams.ts` + 适配器 `workflow:` 分支 + 设置页「加一条工作流（填 workflowId）→ 拉参数 → 勾选暴露」 | 单测：`parseWorkflowJsonToFields` 对固定夹具逐字断言（含跳过链接值、默认全隐藏）；适配器单测：请求体只含 exposed 字段、媒体字段是 upload 回来的 `fileName`；真机：一条真工作流跑出图 |
| **P2 生成节点参数区** | 来源行 + 动态参数渲染 + `params.workflow` 下发 | 冒烟：选一条带 6 个字段的工作流 → 节点上只出现 4 个（隐藏的 2 个不在 DOM）→ 运行记录里请求体恰好 4 项；`api` 来源回归全绿 |
| **P3 AI 应用参数如实化** | 用 `apiCallDemo` 的字段替换现在按名字猜的写法 | 单测：字段名改成作者自定的中文名时仍能下发（现在会静默丢弃）；真机：一个非英文命名的应用跑通 |
| **P4 CLI 来源** | 来源可选 `cli` + 四个工具模板 + 产物回填 | 冒烟：桌面版跑 `rh image` 出一条真图并落成节点产物；浏览器版如实禁用 |

---

## 八、参考链接

- RunningHub 官网 / 取 Key / 标准模型 API / 调用记录：见 §6
- `HM-RunningHub/RH_CLI`：<https://github.com/HM-RunningHub/RH_CLI>
- `HM-RunningHub/ComfyUI_RH_APICall`（工作流）：<https://github.com/HM-RunningHub/ComfyUI_RH_APICall>
- `HM-RunningHub/ComfyUI_RH_OpenAPI`（标准模型）：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI>
- `hero8152/Infinite-Canvas`（用户指定参考）：<https://github.com/hero8152/Infinite-Canvas>
- `Work-Fisher/AIFISHER`（同赛道）：<https://github.com/Work-Fisher/AIFISHER>

---

## 九、GitHub 官方仓库的改版（2026-11-14 核对）

> 用户问「GitHub 改版了啥」。以下全部来自仓库提交记录与文件原文，不是印象。

### A. 时间线（官方三个仓库）

| 仓库 | 最近提交 | 说明 |
| --- | --- | --- |
| `HM-RunningHub/ComfyUI_RH_OpenAPI` | **2026-11-10**「publish **62** OpenAPI nodes and **verified price summaries**」；**2026-11-02**「publish 18 API nodes and refresh public model contracts」；2026-10-09「refreshed OpenAPI catalog and image alpha fix」 | 标准模型这条线在持续发版，且**开始公开价格摘要** |
| `HM-RunningHub/ComfyUI_RH_APICall` | 2026-05-09「**fix: allow larger node info ids**」 | 官方也在修"id 太长"——与轻画 #1109（19 位 `webappId` 精度）同一个坑 |
| `HM-RunningHub/RH_CLI` | 最后 2026-06-01（初始发布） | CLI **没有跟上 v2 路由**，用的还是 `/task/openapi/ai-app/run`；轻画不能只信它 |

### B. 新增的大块头：`developer-kit/`（专给 AI 编程代理用的）

`ComfyUI_RH_OpenAPI/developer-kit/` 下新增：

| 文件 | 内容 | 对轻画的价值 |
| --- | --- | --- |
| `llms.txt` | **22 条硬规则**：Bearer 鉴权、媒体先 `POST /media/upload/binary` 再提交、提交只回 `taskId`、轮询 `/query`、`SUCCESS/FAILED/CANCEL` 是终态、**不许编端点/参数/枚举**、布尔要真布尔、必填先校验、只重试 429/5xx、价格只作参考 | 与我们踩过的坑逐条对上（尤其"不许编默认值/枚举"） |
| `rh-api-contract.md` | 生命周期契约（提交 → 轮询 → 结果解析 → 重试 → 日志脱敏） | 与我们 `runninghubWorkflow.ts` 的实现基本一致，可当验收清单 |
| `model-registry.public.json` | **约 2 MB / 500+ 模型**：`endpoint / output_type / category / name_cn / params[{fieldKey,type,required,label,description,defaultValue,options[{value,description}],accept,maxSize}]` | **可以把轻画手挑的 49 个模型升级成官方全量，且参数枚举/媒体限制自动就有**（现在 `options` 靠人工配） |
| `pricing.public.json` | **511 条价格**：`currency` 全为 **CNY**，`unit` = `/次` `/秒` `/张` `/1000字符` …，`pricing_type` = `fixed`(196) / `parameter_based`(243) / `rate`(8) / `starting_at`(38) / `unparsed`(26) | 可做"跑之前先报参考价"；但**只是 CNY 口径**（见 §九 C） |
| `examples/python/*` + `tests/test_contract.py` | 无依赖最小客户端 + mock 一致性测试 | 可当我们适配器的对照实现 |

### C. 「积分」到底是什么（用官方公开数据能说到哪一步）

1. `pricing.public.json` 里 **511 条价格全部 `currency: CNY`**，没有任何积分/点数单位 ⇒ **官方公开的价格体系是"金额（人民币）"**。
2. 该 kit 的 README 明确写：`pricing.public.json`「**does not include internal billing IDs, raw expressions, or database fields**」，`model-registry.public.json`「Internal fields such as **pricing metadata** are removed」⇒ **积分那套是内部计费层，官方没公开**。
3. 真机侧看到的是另一层：`accountStatus` 回 `remainMoney / remainCoins / remainPoint`，任务结果 `usage` 回 `consumeMoney / consumeCoins / chargedPoint + settleMode:"POINT"`；消费级 Key（`apiType:"NORMAL"`）提交时被 `821 付费积分余额不足` 拦 —— 其中 `remainPoint` 里的 30 是**免费积分，API 不认**。

⇒ 结论（可确认部分）：**积分是消费级/会员那条线的预付费点数**，与"金额（CNY）"是两套计费层，官方 API 文档只公开后者；**积分与人民币的换算比例、每个模型多少积分，官方没有公开**，只能在 runninghub 网页的「积分明细」里看。
⇒ 对轻画的要求：**不要把 CNY 价格当积分数显示**，也不要把 `remainPoint` 当成"能跑几次"。

### D. 据此新增的缺口

**#1111**：把官方 `developer-kit` 的两份 JSON 接进来（模型目录 + 参考价），见对账清单。