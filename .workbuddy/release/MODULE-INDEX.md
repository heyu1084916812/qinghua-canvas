# AgentPanel 模块索引

> **2026-11-06 全代码治理索引补充**：前两轮新增 109 个生产模块、第四批再新增 22 个生产模块；
> 合计 138 条语义登记的机器可读职责、owns/doesNotOwn、publicApi、
> test 与行数预算统一在 `architecture/module-governance.json`。新增目录包括 `app/projectTree/`、
> `platform/channels/openaiImages/`、`state/project/ecommerceTaskRepository/`、`domain/storyboard/` 子模块、
> `workbenches/ecommerce/studio/`、`workbenches/canvas/panels/creation/`、`canvas/flow/`、`canvas/lightbox/`
> 及 `workbenches/storyboard/videoExecution/`；第四批另增 `state/channel/channelStore/`、
> `canvas/execution/provider/`、`pages/EcommercePage/{ecommercePage,workbench}/`、
> `platform/channels/runninghubEndpoints/` 与 `ecommerce/studio/controller/`。
> 本索引主体仍是 AgentPanel 目录；跨域模块导航以治理登记为准。

> **2026-11-05 结构治理第二批（模块导航补充）**：本索引主体是 AgentPanel 目录；第二批新增的
> 三个模块目录外职责由 `architecture/module-governance.json` 机器登记，当前真相源补充如下：
> `src/app/runtime/projectOperationLock.ts` 只管项目占用索引与 opaque owner，
> `src/state/channel/channelRequestOrchestration.ts` 只管渠道直连请求编排，
> `src/workbenches/canvas/execution/canvasRunPreflight.ts` 只管画布运行前预检。
> 三者都不拥有 UI 状态，也不反向依赖 facade；详见《轻画-架构设计文档.md》文首第二批记录。

> **生成方式**：读 `src/workbenches/canvas/panels/AgentPanel/` 的**实际代码**（导出名 / 文件头注释 / `import` 图），不抄任何文档。
> 「→ 依赖谁」「← 谁依赖它」两列是机械扫 `import` 得到的；行数取 2026-11-04 的工作区。
> 职责一栏括号里的 `导出 …` / `头注释` 就是依据；**没有依据的一律标「待确认」**（当前 0 项）。

## 怎么用这份索引

1. **先读三个入口**（第 0 节）——它们决定"面板由哪几块拼成、点击落到哪一层、顺序由谁说了算"。
2. **再看调用图**（第 1 节）——从「用户点发送」到「模型返回」经过哪些文件；下面的**顺序铁律表**告诉你改哪个文件之前必须先看哪份清单。
3. **最后按分组查模块**（第 2–7 节）——纯计算 → 主链编排 → 工具链 → 控制器 hook → 渲染组件 → 目录外的真相源。

## 0. 三个入口文件（新人先读这三个）

| # | 文件 | 为什么是它（依据） |
|---|---|---|
| 1 | **`AgentPanel.tsx`（145 行）** | 组合根。全文 **0 个** `useState/useRef/useMemo/useCallback`，只有 5 个 hook 调用（refs → 会话 → 工具 → 回合 → 视图 props）+ 一张 props 表；一眼看清面板由哪四块拼成。 |
| 2 | **`useAgentPanelTurnModel.ts`（741 行）** | 回合域中枢。文件内 **13 个**回合控制器调用 + 一张 `clear()` 关停清单；`send` 的三分支分诊（任务命令 / 忙时排队·引导 / 直接发）也在这。用户"点了没反应"九成落在这层。 |
| 3 | **`agentSendTurnRun.ts`（330 行）** | 顺序宿主。文件内 6 处 `A-5 #n` 顺序注释；**基线清单**在 `agentSendTurnPlan.ts` 顶部（10 条），由 `agentSendTurnRun.test.ts` 逐条断言。 |

> 补一句：若你要先搞懂**状态**而不是**点击**，第三个改读 **`useAgentPanelSessionModel.ts`（863 行）**——14 个控制器的装配都在那，"这个按钮拿到的是这个值"的答案在那里。

## 1. 调用图：用户点发送 → 模型返回

```
用户点发送（AgentComposerPane 的 onSend）
        │
        ▼
useAgentPanelTurnModel.send()        ← 分诊：任务命令 / 忙时(排队·引导) / 直接发
        ├──► useAgentTaskPlanController.advanceTaskPlan    （支线：推进计划）
        ├──► useAgentSteeringController.guideDraft         （支线：忙 + 引导模式）
        ├──► useAgentQueueController.queueText             （支线：忙 + 排队模式）
        ▼
useAgentSendController.sendText()    ← 只解析「发哪个会话」+ 跟随滚动
        ▼
agentSendFlow.runAgentSendFlow()     ★ 铁律①：活动锁生命周期
        │                              抢锁 claimSessionActivity → runTurn → finally releaseSessionActivity
        ▼
useAgentSendTurnController.runSendText()   ← 只把端口摆好
        ▼
agentSendTurnRun.runAgentSendTurn()  ★ 铁律②：A-5 十条顺序
        │  1 清 currentTurnJobIdRef（同步，先于 prepare）
        │  2 清 taskPlan（shouldClearTaskPlan）
        │  3 prepare：onPersisted ▸ onRouteReady
        │        └─► useAgentPrepareTurnController ─► agentTurnRequest.ts  ★ 铁律③：准备顺序唯一真相
        │  4 写 5 个 per-session ref（contextTrace/toolMode/explicit/perImage/turnTools）
        │  5 loopDeps ─► useAgentLoopDepsController ─► agentLoopDeps.ts（纯装配）
        │  6 runAgentTurn（agent/agentLoop.ts，真正的模型循环）
        │        └─ 工具调用 ─► useAgentPanelToolModel.toolCtx ─► agentToolContext.ts（21 键 compose）
        │        │                └─► agentToolExecution.ts（记账）
        │        └─► continueAgentAutoConfirmations（agentAutoConfirmations.ts，≤32 步）
        │  7 handleOutcome ─► useAgentOutcomeCoordinator ─► agentOutcomeCoordinator.ts（写回 + revision CAS）
        │  8/9/10 routeReady ▸ abortRefs.set ▸ return outcome
        ▼
  放锁：正常发送走 agentSendFlow 的 finally；
        确认卡 / 继续任务 两条支路走 useAgentQueueController.settleSessionOutcome
```

### 顺序铁律在哪个文件

| 铁律 | 文件（改它之前先看清单） |
|---|---|
| 发送回合 10 步 | `agentSendTurnRun.ts`（清单在 `agentSendTurnPlan.ts` 顶部，断言在 `agentSendTurnRun.test.ts`） |
| prepare 内部顺序（`onPersisted` ▸ `onRouteReady`） | `agentTurnRequest.ts` |
| 活动锁抢/放 | `agentSendFlow.ts`（正常发送）、`useAgentQueueController.ts`（确认 / 继续） |
| 确认收口顺序 | `agentConfirmationRun.ts`（失败收口的模板见 `agentContinuationRun.failRoute`） |
| 中断 / 停止收口顺序 | `agentInterruptSettlement.ts` |
| 工具上下文取值时机 | `useAgentPanelToolModel.ts`（`toolCtx`）+ `agentToolContext.ts`（compose） |

## 2. 纯计算（无 React、无单例，最容易单测）

| 文件 | 一句话职责（依据） | → 依赖 / ← 被依赖 |
|---|---|---|
| `conversation.ts` (810) | 消息 → 对话条目投影：工具结果可读化、确认卡文案、过程条目（导出 `toConversation/describeToolResult/processEntriesOf`） | → 无　← AgentActivityViews / agentConversationItems / AgentConversationPane / useAgentConversationController |
| `agentConversationItems.ts` (123) | 条目 / 节点标题 / 最新消息下标 / 素材哈希（导出 `buildConversationItems/buildNodeTitles/buildAssetHashByNode`） | → conversation　← useAgentPanelSessionModel |
| `agentConfirmationPreview.ts` (212) | 「确认卡上要显示什么」——花钱和写画布之前先说明白（头注释 + 导出 `previewOf`） | → AgentActivityViews / conversation　← AgentConversationPane / useAgentPanelTurnModel |
| `agentActivitySummary.ts` (22) | 请求 / 思考 / 工具活动的一句话摘要，48 字上限（导出 `conciseAgentRequest/agentThinkingSummary/agentToolActivitySummary`） | → 无　← AgentActivityViews |
| `agentOutputReveal.ts` (21) | 正文逐步揭示的节奏：每次几个字、多少 tick 到齐（导出 `agentRevealChunkSize/nextAgentRevealLength`） | → 无　← AgentActivityViews / useAgentConversationController |
| `agentRunState.ts` (48) | 从 RunRecord 取「最近一次失败」（导出 `latestRunFailureOf`；头注释：执行层会清节点瞬时状态，但 RunRecord 永久保留） | → 无　← agentLoopDeps |
| `agentRunTasks.ts` (105) | 运行任务（queued/running/done/failed）的创建、推进与统计（导出 `createAgentRunTasks/finishAgentRunTask/agentRunTaskCounts`） | → 无　← AgentActivityViews / agentCanvasRun / AgentConversationPane / useAgentRunPresentation |
| `agentProcessText.ts` (22) | 过程行取「最新一行可读文本」+ 识别「推进任务计划」命令（导出 `latestProcessLine/isAdvanceTaskCommand`） | → 无　← AgentActivityViews / AgentConversationPane / useAgentPanelTurnModel |
| `agentComposerLayout.ts` (54) | 输入框高度的上下限、clamp、持久化 key（导出 `clampAgentComposerHeight/AGENT_COMPOSER_HEIGHT_KEY`） | → 无　← AgentComposerPane / useAgentComposerController |
| `agentDraft.ts` (103) | 草稿按 `sessionId` 持久化（一份 JSON）+ 从草稿反算引用的 node id（导出 `loadAgentDraft/saveAgentDraft/draftNodeIds`） | → 无　← useAgentComposerController |
| `agentConversationScroll.ts` (36) | 滚动判据：距底多远、要不要显示「回到底部」、视口变矮后滚到哪（导出 `agentShouldFollowLatest/agentScrollTopAfterShrink`） | → 无　← useAgentConversationController |
| `mediaMentions.ts` (39) | 正文 @ 里显式指定的生成模型，每类只认第一个（导出 `explicitMediaModelsFromMentions`） | → 无　← agentSendTurnRun / agentTurnRequest / agentToolRecipeContext / useAgentSendTurnController |
| `agentTurnPersistence.ts` (158) | 用户消息落库时机 + 模型消息组装（导出 `persistAgentUserTurnBeforeRequest/buildAgentModelMessages/composeAgentOutcomeMessages`） | → 无　← agentOutcomeCoordinator / agentOutcomeOrigin / agentSendTurnRun / agentTurnRequest |
| `agentOutcomeOrigin.ts` (51) | 结果收口该绑哪个 revision（`persistedTurn → session → ref` 三层回退；导出 `outcomeTurnOriginFor`） | → agentInterruptOrigin（同源对照）　← useAgentPanelTurnModel |
| `agentInterruptOrigin.ts` (76) | 中断 origin（jobId / turnId / revision 三条回退）+ 六张 per-session 表清理（导出 `interruptOriginFor/clearTurnRefs`） | → 无　← agentOutcomeOrigin / 确认·中断·停止三控制器 |
| `agentInterruptSettlement.ts` (160) | 停止 / 取消的**统一收口顺序**：abort → 落库 → Job → steers → 队列 → 清 refs → UI（导出 `settleAgentInterruption`） | → 无　← 确认 / 中断 / 停止三控制器 |
| `agentSendTurnPlan.ts` (113) | 发送前纯决策（seed / 清 plan / 失败载荷）+ **10 条顺序清单**（头注释即基线） | → AgentActivityViews　← agentSendTurnRun |
| `agentLoopInputs.ts` (61) | 收集本轮视觉输入素材：显式引用节点 + 项目套件去重（头注释 + 导出 `collectAgentLoopInputs`） | → 无　← agentLoopDeps |
| `agentLoopTrace.ts` (76) | 本轮直连追踪信息 + 路由候选提升（导出 `agentLoopTrace/promoteAgentChatRouteCandidate`） | → agentChatRoute / agentTurnRequest　← agentLoopDeps |
| `agentChatRoute.ts` (12) | 纯类型：聊天路由的形状（无运行时导出，架构护栏已登记） | → 无　← continuationRun / loopDeps / loopTrace / turnRequest / visualReview / useAgentChatRouting |
| `agentPanelViewHelpers.tsx` (47) | 模型候选 → 带厂商标图的选项；origin / viewport 换算（导出 `withModelIcons/originOf/viewportWorldOf`） | → 无　← AgentComposerPane / agentLoopDeps / useAgentAttachmentsController / useAgentPanelToolModel |
| `agentSessionRuntime.ts` (47) | 面板内不参与渲染、但跟随会话保存的瞬时态（perImage、sticky 模型；头注释 + 导出 `AgentSessionRuntimeState`） | → 无　← useAgentPanelRefs |
| `agentShellLayout.ts` (261) | 壳层几何：面板宽度吸附、浮球 clamp（头注释：**不传 `area` = 只重算宽度、不夹 Y**） | → 无　← AgentDock |

## 3. 主链编排（非 React 的顺序宿主）

| 文件 | 一句话职责（依据） | → 依赖 / ← 被依赖 |
|---|---|---|
| `agentSendFlow.ts` (209) | 一次发送的**活动锁生命周期**：抢锁 → runTurn → 失败/成功收尾 → `finally` 放锁（导出 `runAgentSendFlow/beforeAgentSendFlow`；`claim/releaseSessionActivity` 在 77–85 / 203–206） | → AgentActivityViews / sessionActivity　← useAgentSendController |
| `agentSendTurnRun.ts` (330) | 一次回合的主体：准备 → 写 ref → 跑 → 自动续跑 → 收口（头注释："这里只有顺序与所有权"；6 处 `A-5 #n`） | → agentSendTurnPlan / agentTurnPersistence / agentTurnRequest / mediaMentions　← prepareTurn & sendTurn 控制器 |
| `agentTurnRequest.ts` (514) | 发送前的准备：系统提示、路由、context trace、落库（导出 `prepareAgentTurnRequest`；7 个调用方） | → agentChatRoute / agentTurnPersistence / mediaMentions　← loopDeps / loopTrace / sendTurnRun / prepareTurn & sendTurn 控制器 / turn model |
| `agentLoopDeps.ts` (470) | AgentLoop 的端口装配（纯函数、无状态；导出 `assembleAgentLoopDeps`） | → chatRoute / loopInputs / loopTrace / runState / turnRequest / visualReview　← useAgentLoopDepsController / turn model |
| `agentAutoConfirmations.ts` (127) | 「确认 → 执行 → 再确认」循环，含轮数上限（导出 `continueAgentAutoConfirmations`；上限常量在 turn model = 32） | → 无　← useAgentPanelTurnModel |
| `agentOutcomeCoordinator.ts` (315) | 一次结果写回：消息 / 确认卡 / 继续点 / 失败 + revision CAS（导出 `coordinateAgentOutcome`） | → AgentActivityViews / agentTurnPersistence　← 确认·续跑·outcome 三处 |
| `agentConfirmationRun.ts` (226) | **确认卡那一条**的收口顺序：Job 转态兜住、settle 无条件（导出 `runAgentConfirmation`） | → agentOutcomeCoordinator　← useAgentConfirmationController |
| `agentContinuationRun.ts` (303) | **「继续任务」那一条**的收口顺序（`failRoute` 是各条失败收口的模板） | → agentChatRoute / agentOutcomeCoordinator　← useAgentContinuationController |
| `agentToolExecution.ts` (131) | 工具调用记账：Job 归属、replay、needs_attention、conflict（导出 `createAgentToolExecution`） | → 无　← useAgentPanelToolModel |
| `agentCanvasRun.ts` (183) | 真正跑画布节点：preflight → waves → RunRecord / 任务（导出 `runAgentCanvasNodes/agentCanvasFailureText`） | → agentRunTasks　← agentToolCanvasOps / tool model |
| `agentVisualReview.ts` (257) | 视觉审阅：成品图发给模型换结构化结论（导出 `runAgentVisualReview`；依赖 domain 的 visualReview 提示词） | → agentChatRoute　← agentLoopDeps |
| `agentInitialLoad.ts` (150) | 启动加载 + 孤儿会话清理（重试、一次性提示、绝不静默；头注释 + 导出 `runAgentInitialLoad`） | → 无　← useAgentInitialLoadController |
| `agentPanelShutdown.ts` (70) | 面板关闭屏障：在途 Promise + 最终 flush + 超时（头注释 + 导出 `createAgentPanelShutdownControl`） | → 无　← useAgentPanelTurnModel |

## 4. 工具链（模型能碰到的能力，全部在 `toolCtx` 背后）

| 文件 | 一句话职责（依据） | → 依赖 / ← 被依赖 |
|---|---|---|
| `agentToolContext.ts` (89) | 21 键 compose；**条件键不出键**（`taskPlan` / `signal` / `perImage`；导出 `composeAgentToolContext`） | → 5 个 builder　← useAgentPanelToolModel |
| `agentToolRecipeContext.ts` (128) | 生成配方取值：模型优先级 / 渠道反查 / 素材过滤，全部 getter 化（导出 `createAgentToolRecipeContext`） | → agentToolContextAssets / mediaMentions　← agentToolContext / tool model |
| `agentToolResearch.ts` (117) | 设计调研工具；`signal` 是 thunk（跑起来那刻才取）（导出 `createAgentToolResearch`） | → 无　← agentToolContext / tool model |
| `agentToolDefaults.ts` (35) | agent 建的节点与手建节点用同一套默认值（头注释 + 导出 `createAgentToolDefaults`） | → 无　← agentToolContext / tool model |
| `agentToolPlanPorts.ts` (60) | 工具层读写 `taskPlan` 的端口（落库投影顺序；导出 `createAgentToolPlanPorts`） | → 无　← agentToolContext / tool model |
| `agentToolCanvasOps.ts` (103) | 跑节点 / 裁剪 / 宫格切分；上下文素材**调用时现取**（导出 `createAgentToolCanvasOps`） | → agentCanvasRun / agentToolContextAssets　← agentToolContext / tool model |
| `agentToolContextAssets.ts` (14) | 进生成节点的上下文素材**只收图片**（头注释 + 唯一实现 `imageContextAssets`） | → 无　← agentToolCanvasOps / agentToolRecipeContext |

## 5. 控制器 hook（React 装配层：只接线，逻辑在上面那些文件里）

| 文件 | 一句话职责（依据） | → 依赖 / ← 被依赖 |
|---|---|---|
| `useAgentPanelRefs.ts` (80) | **17 个 per-session ref 的唯一宿主**（头注释："同一个 Map 若被两个 hook 各自 `useRef` 就是两份状态"） | → agentSessionRuntime / agentTurnRequest(类型)　← 面板 + 三个模型 |
| `useAgentPanelSessionModel.ts` (863) | 会话域：列表 / 当前 / 消息 / 草稿 / 模型 / 技能 / 素材 / 对话展示（文件内 14 个 hook 装配） | → 14 个模块（见 import）　← 面板 / tool / turn |
| `useAgentPanelToolModel.ts` (259) | 工具域：`toolCtx` + 执行账本（头注释："价值全在取值时机"） | → 6 个 tool 模块 + agentToolExecution　← 面板 / turn |
| `useAgentPanelTurnModel.ts` (741) | 回合域：发送 / 队列 / 引导 / 确认 / 继续 / 停止 + **关停清单**（13 个控制器） | → 13 个回合控制器　← 面板 |
| `useAgentPanelViewProps.ts` (260) | 视图 props 装配（header / conversation / composer 三包；头注释） | → 三个 Pane + Header + 2 个控制器类型　← 面板 |
| `useAgentSessionLifecycle.ts` (214) | `list` / `current` / `messages` 的 React 投影（`switchTo` / `patchSession` / `applySessionSnapshot`） | → 无　← session model / actions / initialLoad / queue |
| `useAgentSessionActionsController.ts` (253) | 新建 / 改名 / 两步删除 / 编辑态（导出即全部接口） | → lifecycle(类型)　← session model / viewProps |
| `useAgentComposerController.ts` (430) | 草稿 / mention / picker / 输入框高度（导出含 `replaceDraft/resetForSession/writeDraftForSession`） | → agentComposerLayout / agentDraft　← session model / viewProps |
| `useAgentChatRouting.ts` (216) | 聊天路由准备与缓存（导出 `prepareChatRoute/commitChatRoute/modelRoute`） | → agentChatRoute(类型)　← session model |
| `useAgentModelSelectionController.ts` (266) | 模型清单 / 逻辑名归一 / 选中与 sticky（导出 `pickModel/setModelKind/selectedModelOf`） | → 无　← session model |
| `useAgentSkillsController.ts` (175) | 技能选择 / handoff / 导入 / 收藏（导出 `setSkill/importSkills/toggleSkillFavorite`） | → 无　← session model |
| `useAgentSkillChipReset.ts` (67) | 删正文技能 chip → 清会话技能设置，只认一次真实删除（头注释） | → 无　← session model |
| `useAgentAttachmentsController.ts` (278) | 附件三入口（文件 / 素材库 / 画布投递）+ 引用缩略图（导出 `attachFiles/addFromLibrary/thumbOf`） | → agentPanelViewHelpers　← session model |
| `useAgentConversationController.ts` (247) | 对话展示控制：揭示、展开、回到底部、切会话复位（导出 `beginReveal/toggleStep/jumpToLatest`） | → conversationScroll / outputReveal / conversation　← session model |
| `useAgentRunPresentation.ts` (134) | 按 `sessionId` 分桶的可视运行态：status / tasks / activities / process（头注释） | → AgentActivityViews / agentRunTasks　← session model |
| `useAgentInitialLoadController.ts` (144) | 初始加载 effect：三重守卫（alive / 已有 current / selectionVersion）+ 实时渠道 | → agentInitialLoad　← session model |
| `useAgentAutoRunController.ts` (156) | per-session 自动执行开关：乐观写 + 写链 + 回滚到**已落库值**（导出 4 张表） | → AgentActivityViews　← turn model |
| `useAgentLoopDepsController.ts` (166) | `assembleAgentLoopDeps` 的装配层（头注释） | → agentLoopDeps　← turn model |
| `useAgentOutcomeCoordinator.ts` (151) | `coordinateAgentOutcome` 的装配层，绑 `turnOriginFor` | → agentOutcomeCoordinator / agentTurnPersistence　← turn model |
| `useAgentPrepareTurnController.ts` (104) | `prepareAgentTurnRequest` 的**入参装配**（头注释） | → agentSendTurnRun(类型) / agentTurnRequest　← turn model |
| `useAgentSendTurnController.ts` (185) | 发送主体的装配层（头注释："React 装配层"） | → agentSendTurnRun / agentTurnRequest / mediaMentions　← turn model |
| `useAgentSendController.ts` (129) | 发送入口：解析会话 + 跟随滚动（`runTurn:` 把 `runSendText` 交给 `agentSendFlow`） | → agentSendFlow / queue(类型)　← turn model |
| `useAgentQueueController.ts` (435) | 持久队列：排队 / 编辑 / 泵 / 结算（`settleSessionOutcome` 的唯一定义处） | → AgentActivityViews / lifecycle(类型)　← turn model / send 控制器 |
| `useAgentSteeringController.ts` (317) | 草稿引导 / 队列转引导（含「正在发送中，不能转成引导」拒绝） | → AgentActivityViews　← turn model |
| `useAgentConfirmationController.ts` (212) | 确认卡的确认 / 取消（共用 `confirmingRef`；头注释） | → confirmationRun / interruptOrigin / interruptSettlement　← turn model |
| `useAgentContinuationController.ts` (143) | 检查点「继续任务」（头注释） | → continuationRun　← turn model |
| `useAgentStopController.ts` (81) | 「停止本回合」——**故意不看** `confirmingRef`（头注释） | → interruptSettlement / AgentActivityViews　← turn model |
| `useAgentInterruptSettlementController.ts` (156) | 中断收口装配：六张表 + origin | → interruptOrigin / interruptSettlement　← turn model |
| `useAgentTaskPlanController.ts` (228) | 直接推进任务计划，含「切走就不再推进」的提交点复检（导出 `advanceTaskPlan/isAdvancingTaskPlan`） | → AgentActivityViews　← turn model |

## 6. 渲染组件（只摆位置、转发事件）

| 文件 | 一句话职责（依据） | → 依赖 / ← 被依赖 |
|---|---|---|
| `AgentPanelView.tsx` (57) | 面板纯壳：Header + Conversation + Composer + aside / data 属性（头注释） | → 三个 Pane + Header　← AgentPanel / viewProps |
| `AgentPanelHeader.tsx` (182) | 会话头：标题改名（`data-agent-rename-save/cancel`）、新建（`data-agent-new`）、会话数（`data-agent-session-count`） | → CSS　← AgentPanelView / viewProps |
| `AgentConversationPane.tsx` (531) | 对话区：消息、过程、确认卡预览、队列、状态行（`data-agent-status-line`） | → ActivityViews / QueuePanel / StepIcon / TaskPlanCard / MentionRichText / conversation　← View / viewProps |
| `AgentComposerPane.tsx` (703) | 输入区：编辑器、发送 / 停止（`data-agent-stop` 只在 thinking/toolRunning/executing 渲染）、模型 / 技能 / 素材入口 | → ActivityViews / composerLayout / SkillMenu　← View / viewProps |
| `AgentQueuePanel.tsx` (215) | 队列条 + 队列菜单（`data-agent-queue-more/menu`，外面点一下收起） | → ActivityViews　← ConversationPane / session model(类型) |
| `AgentActivityViews.tsx` (477) | 状态 / 活动 / 缩略图基础视图 **+ `statusIsBusy` / `statusCanSteer` 判定**（导出两个判定函数） | → activitySummary / outputReveal / processText / runTasks / conversation　← 20 个调用方（见反向引用） |
| `AgentStepIcon.tsx` (216) | 步骤图标：lucide 子集（头注释） | → 无　← ConversationPane |
| `MentionRichText.tsx` (62) | **只读**的 @ 引用渲染：与输入框同一套矩形框（头注释） | → 无　← ConversationPane |
| `SkillMenu.tsx` (469) | 对话窗里的技能菜单（收藏 / 导入 / 技能库入口；头注释） | → CSS　← ComposerPane |
| `TaskPlanCard.tsx` (233) | 任务计划卡：步骤列表 + 进度 + 展开收起 + 「下一步」按钮（`data-agent-task-plan-next` / `data-agent-task-step`） | → CSS　← ConversationPane |
| `AgentDock.tsx` (624) | 浮球 + 面板外壳：开合、拖拽、几何（依赖 `agentShellLayout`） | → agentShellLayout / AgentPanel　← CanvasAgentHost |
| `CanvasAgentHost.tsx` (178) | 画布路由里的常驻宿主（离开路由不卸载；导出 `CANVAS_AGENT_HOST_KIND/CanvasAgentHostRenderer`） | → AgentDock / canvasAgentHostShutdown |
| `canvasAgentHostShutdown.ts` (59) | 宿主的关停屏障（导出 `createCanvasAgentHostShutdownControl`） | → 无　← CanvasAgentHost |

## 7. 真相源在本目录之外（新人必须知道）

| 模块 | 职责 |
|---|---|
| `state/agent/sessionStore.ts` | 会话真相：`appendPendingAssetIds`（事务内追加）、`promoteQueuedTurnToSteer`（`activeTurnId` 互斥）、`updateFields`（事务内整字段替换） |
| `state/agent/jobStore.ts` | Job 的持久存储 |
| `features/shared/agent/AgentController.ts` | Job 状态机：`ensureJob` / `transition` / `failTurn` / `finishQueuedTurn` |
| `features/canvas/agent/sessionActivity.ts` | **内存活动锁**：`claimSessionActivity` / `releaseSessionActivity`——"busy" 的唯一判据 |
| `workbenches/canvas/agent/agentLoop.ts` | 真正的模型循环：`runAgentTurn` / `resumeAgentTurn` / `errText` |

---

**待确认项**：无。原稿里唯一一个（`TaskPlanCard` 是否含推进按钮）已在落盘前现场核过：含 `data-agent-task-plan-next`（`TaskPlanCard.tsx:118`）。
