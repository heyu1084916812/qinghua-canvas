# 轻画代码结构债与拆分治理方案

> **2026-11-05 第三批第一刀（删改/挪目录门禁）**：本轮不继续硬拆业务大文件，而是补结构治理的
> 「下游维护面」：`removedModules` / `moduleMoves` 显式台账、递归生产目录预算、基线生产文件消失
> 检测、搬家目标存在且已登记、登记/legacy 项失效红例。当前 P1/P2 大文件尚未拆；下方路线里的
> 「短期执行建议」保留为历史，第三批状态以《轻画-功能对账清单.md》`M-P0-SPLIT-3` 为准。

> **2026-11-05 第二批已完成（总管2 收口）**：锁、渠道请求编排与 `runPreflight` 三刀已落地。
> 下方「三条 P0 审计结论」与「短期执行建议」保留为当时审计记录；**排期状态以本段和对账清单
> `M-P0-SPLIT-2` 为准**。本批把 `channelStore` 1595 → 1308、Registry 950 → 948、
> `CanvasExecutionProvider` 1606 → 1509，新模块 91 / 326 / 364 行；模块职责登记与收紧后的
> legacy 预算在 `architecture/module-governance.json`。下一切口仍按真实需求决定，不在本轮
> 冒充把全仓降到「安全范围」。

> 状态：治理基线  
> 日期：2026-11-05  
> 当前代码基线：`c91a524`
> 结构治理落地提交：`cfb4f0a`
> 适用范围：整个 `src/`，重点是 Agent、电商、设置、画布执行、渠道和项目运行态  
> 本文性质：结构治理方案，不是功能需求文档  
> 判定原则：功能是否完成仍以 `轻画-功能对账清单.md` 为准；本文只解决代码结构、拆分顺序、行为边界和门禁

---

## 一、结论

轻画不是“问题多到不能用”，而是已经从一个页面型应用长成了一个包含画布、电商、漫剧、Agent、多渠道、桌面包和持久化迁移的中型产品。功能在持续增长，代码组织却仍有不少地方保留着早期快速迭代时的单文件结构。

当前主要矛盾不是“有没有架构文档”，而是：

> 文档里写了边界，但代码里没有持续强制边界。

因此出现两类结构债：

1. **单体文件债**：一个文件同时负责 UI、业务编排、状态、存储、网络、错误收口。
2. **隐式耦合债**：模块之间通过共享可变状态、闭包快照、回调链、全局对象、固定顺序或整行覆盖互相影响。

这两类债不会立刻表现为用户可见 bug。它们主要表现为：

- 改一个功能要读很多代码；
- 一个需求牵动多个模块；
- 修复一个问题容易带回另一个问题；
- 测试很多，但很难判断改动影响面；
- 不同人或多个 AI 同时改容易冲突；
- 新功能倾向于继续塞进已有大文件。

目标不是把全仓一次性重写，也不是把所有文件压到固定行数，而是建立一套可持续的拆分方式：

> 一个业务用例有一个薄编排器，编排器依赖稳定门面；门面背后是可独立测试的小模块；状态只有一个真相源；顺序、事务和错误收口集中在一个负责人。

---

## 验证记录（2026-11-05，基线 c91a524）

本文已按当前工作区重新核对，旧数据不再直接作为下一批任务依据。

- **过期快照（保留，不再作为当前依据）**：旧摘要写 `8b50740`、本文 1,626 行、约 43KB；
  其中全仓统计和 Agent 行数也已被后续提交改变，不能继续用于排期或验收。
- **校准前文档实测（本次更新前）**：本文 1,663 行、45,775 bytes（按
  `Get-Content.Count` / `git diff` 的换行口径）；旧摘要的 1,626 行、43KB 已过期。
- **当前代码实测**：HEAD `c91a524`，结构治理门禁由 `cfb4f0a` 落地。
- 实测 TS/TSX：总 1,180、生产 719、测试 461；生产 163,497 行，测试 98,869 行。
- 生产 TS/TSX 超千行：17 个，第一批拆出两个低于 1,000 行。
- 生产 CSS 超千行：7 个，原文写 8 个，已修正。
- Agent：`AgentPanel.tsx` 145、`useAgentPanelSessionModel.ts` 731、
  `useAgentPanelTurnModel.ts` 494、`AgentPanel.module.css` 248、`agentLoop.ts` 837、
  `agentCanvasClaimGuard.ts` 348、`tools.ts` 797、`sessionStore.ts` 787。
- 结构门禁已从方案变成代码：`architecture/module-governance.json` +
  `scripts/module-governance*.mjs`，接入 `npm run check`；现有 18 个 TS/TSX 和 7 个 CSS
  已进入 legacy 白名单，新生产文件默认 TS/TSX 450、CSS 600。

三条 P0 审计结论：

> **2026-11-05 第一批已落地**：渠道凭证已抽到 `channelCredentials.ts` 并统一运行态读口；
> `ProjectRuntimeRegistry` 已先修 pending 订阅异常并抽出只读快照；`CanvasExecutionProvider` 已抽出
> `useCanvasRunRecorder.ts`。这仍是第一批，不代表 P0 全部完成：锁、请求编排和 `runPreflight` 仍在后续。

1. `channelStore` 凭证写入已基本单一化，但读取仍散在 ChannelStore 和三个执行宿主；
   路由快照还存在画布 live-token 双路径。第一刀应做凭证模块并接管运行态读取口，
   不先拆路由；渠道删除的“撤路由/中断在飞任务 → 停用 → 清凭据 → 删行”不可改变。
   `src/platform/generation/generationClient.ts` 已负责选组/读 Key/适配器调用，
   `channelStore.completeWithTools` 的问题是 Store 请求编排，不是缺少另一个 generation client。
2. `ProjectRuntimeRegistry` 可拆，但不能拆成六个平级事务 owner。已发现 pending 订阅回调
   异常可把 registry 卡在 `committing`；必须先修异常隔离，再先抽
   `projectRuntimeSnapshots.ts`，锁下一步再抽。commit/rollback/recovery 不能拆成三个独立事务
   owner，`dispose` 也必须纳入同一生命周期语义。
3. `CanvasExecutionProvider` 未发现可复现重复扣费或资产丢失 P0，但确认 4 个 P1：
   分支取消信号丢失、路由失败状态不完整、融合记录非原子、版本基线初始化失败被吞。
   第一刀应做 `runRecorder`；`runPreflight` 必须排在其后，并先修取消信号与失败状态。

---

## 二、当前结构快照

### 2.1 全仓规模

截至本文编写时的只读统计：

| 指标 | 数量 |
| --- | ---: |
| TS/TSX 文件总数 | 1,180 |
| 生产 TS/TSX 文件 | 719 |
| 测试 TS/TSX 文件 | 461 |
| 生产 TS/TSX 代码行 | 163,497 |
| 测试 TS/TSX 代码行 | 98,869 |
| 超过 1,000 行的生产 TS/TSX 文件 | 17 |
| 超过 1,000 行的生产 CSS 文件 | 7 |

测试代码约占生产代码的 59%。这是明显优势，说明项目不是没有验证；但测试数量多不等于模块边界天然正确。大文件会让测试越来越难定位、越来越慢，也更容易出现“只验证局部、没有验证完整顺序”的假安全感。

### 2.2 Agent 当前状态

Agent 已经从早期 6,000 行级主面板降到当前结构：

| 文件 | 当前行数 | 当前定位 |
| --- | ---: | --- |
| `AgentPanel.tsx` | 145 | 组合根 |
| `useAgentPanelSessionModel.ts` | 731 | 会话域装配 |
| `useAgentPanelTurnModel.ts` | 494 | 回合域装配 |
| `AgentPanel.module.css` | 248 | 面板样式入口 |
| `agentLoop.ts` | 837 | 模型循环与门禁接线 |
| `agentCanvasClaimGuard.ts` | 348 | 能力/完成证据门禁 |
| `tools.ts` | 797 | 工具执行总入口 |
| `sessionStore.ts` | 787 | 会话事务边界（≤790 结构预算） |

Agent 仍是需要继续优化的大型模块，但已经不是全仓最危险的地方。它相对健康的证据是：

- 主文件已很薄；
- 工具执行、计划校验、画布变更工具、会话类型、持久化映射已分层；
- 有结构测试、行数门禁、导出兼容测试；
- 有 MEMORY 和 INVARIANTS 记录操作顺序与历史事故；
- 多次拆分都保留原公共导出并跑定向、全量和干净检出验证。

Agent 可以继续拆，但不应为了追求 300 行而继续碎片化。当前优先级低于画布执行、项目运行态和渠道公共层。

### 2.3 超过 1,000 行的重点文件

以下行数只表示“体量和职责混杂的信号”，不直接等于 bug。

#### 电商

| 文件 | 行数 | 当前混合职责 | 风险 |
| --- | ---: | --- | --- |
| `src/workbenches/ecommerce/EcommerceStudio.tsx` | 3,221 | 生成模式、参数表单、人物设置、结果状态、多个参数子界面 | 高 |
| `src/pages/EcommercePage/EcommercePage.tsx` | 2,185 | 路由、规划会话、执行、素材、结果、下载、项目数据 | 高 |
| `src/pages/EcommercePage/EcommerceWorkbench.tsx` | 1,657 | 画布视口、拖拽、缩放、旋转、框选、小地图、结果任务投影 | 高 |
| `src/state/project/ecommerceTaskRepository.ts` | 1,021 | 任务、结果、排队素材、重试、持久化 | 中高 |
| `src/workbenches/ecommerce/EcommerceStudio.module.css` | 2,042 | 整个电商 Studio 的样式 | 中 |

#### 设置

| 文件 | 行数 | 当前混合职责 | 风险 |
| --- | ---: | --- | --- |
| `src/pages/SettingsPage/SettingsPage.tsx` | 3,015 | 渠道、Token、凭证组、模型映射、路由策略、外观、系统设置 | 高 |
| `src/pages/SettingsPage/SettingsPage.module.css` | 2,476 | 所有设置页样式 | 中 |

#### 画布执行与画布表面

| 文件 | 行数 | 当前混合职责 | 风险 |
| --- | ---: | --- | --- |
| `src/workbenches/canvas/execution/CanvasExecutionProvider.tsx` | 1,606 | 启动运行、路由、循环、技能、合成、节点执行、整组执行、取消；引擎外记录已下沉 | 最高 |
| `src/workbenches/canvas/flow/FlowSurface.tsx` | 1,576 | 节点渲染、拖拽、连线、框选、右键菜单、导入、视口同步、删除 | 高 |
| `src/workbenches/canvas/panels/CreationPanel.tsx` | 2,437 | 图片/视频参数、模型选择、生成配置、质量参数 | 高 |
| `src/workbenches/canvas/lightbox/LightboxLayer.tsx` | 1,764 | 灯箱、图片查看和编辑交互 | 中高 |

#### 渠道和上游适配

| 文件 | 行数 | 当前混合职责 | 风险 |
| --- | ---: | --- | --- |
| `src/state/channel/channelStore.ts` | 1,595 | 渠道 CRUD、凭证 facade、协议、模型、路由、配方、请求编排 | 最高 |
| `src/platform/channels/openaiImages.ts` | 1,685 | 多上游图片响应、轮询、错误提取、图片解析、适配器 | 高 |
| `src/platform/channels/runninghubEndpoints.ts` | 1,032 | RunningHub 端点与协议细节 | 中高 |
| `src/platform/channels/runninghub.ts` | 约 866 | RunningHub 适配实现 | 中高 |

渠道已经正确收口为中央公共层。当前问题不是“没有公共层”，而是公共层内部同时承担门面、仓储、配置、路由和生成客户端。

#### 项目运行态

| 文件 | 行数 | 当前混合职责 | 风险 |
| --- | ---: | --- | --- |
| `src/pages/ProjectsPage/ProjectsPage.tsx` | 1,421 | 项目列表、批量操作、删除确认、错误与恢复 | 高 |
| `src/app/ProjectTree.tsx` | 1,273 | 项目树、新建、重命名、删除、繁忙态、恢复入口 | 高 |
| `src/app/ProjectRuntimeRegistry.ts` | 950 | 操作锁、prepare、commit、rollback、recovery、dispose；快照已下沉 | 最高 |

`ProjectRuntimeRegistry` 是一个高风险状态机。它本身可以继续担任编排门面，但内部应拆成锁、准备、提交、恢复、快照五块。

#### 其他明显大文件

- `src/domain/storyboard/storyboard.ts`：1,749 行
- `src/workbenches/storyboard/useStoryboardVideoExecutionController.ts`：1,028 行
- `src/pages/AssetsPage/ContextKitsDialog.tsx`：1,135 行
- `ContextKitsDialog.module.css`：1,014 行
- `AssetsPage.module.css`：1,540 行
- `SkillsPage.module.css`：1,015 行

这些不是第一批必须拆的对象，但应纳入同一套门禁。下一次真实需求触及时，按职责边界拆，不为了行数单独重构。

---

## 三、为什么当时没有暴露

### 3.1 功能增长是渐进的

最初可能只有一个页面、几个参数、一条执行链。后来不断增加：

- 新模型；
- 新渠道；
- 新参数；
- 自动路由；
- 任务队列；
- 中断恢复；
- 结果记录；
- 重试；
- 多工作台；
- 桌面端 IPC；
- 存储迁移。

每次只加几十行，单次改动都合理，累积后形成数千行文件。

### 3.2 当前用户路径没有覆盖结构成本

用户正常使用时走的是功能主路径。结构债主要在以下场景暴露：

- 新功能需要修改已有流程；
- 并发、恢复和失败路径需要排查；
- 多人或多个 AI 同时开发；
- 测试变慢或难以定位；
- 上游协议变化；
- 迁移旧数据；
- 需要明确“这件事到底由谁负责”。

### 3.3 测试证明的是当前行为，不是未来可维护性

测试可以证明：

- 当前流程能跑；
- 当前错误路径符合预期；
- 当前 UI 没有回归。

测试不能自动证明：

- 文件职责单一；
- 新功能应该加在哪里；
- 两个模块是否共享了隐藏状态；
- 新代码是否会继续堆进同一个文件。

### 3.4 文档治理没有完全变成代码门禁

轻画的文档体系已经相当完整，但过去门禁主要集中在 Agent 主文件、依赖方向和部分架构规则，没有覆盖：

- 每个领域的文件行数上限；
- 新增文件必须登记职责；
- 公共门面背后的内部模块数量；
- Store 是否同时承担网络和持久化；
- UI 是否直接读取底层仓储；
- 跨域小模块是否互相 import；
- 拆分后是否把代码换个文件继续膨胀。

---

## 四、先统一几个概念

### 4.1 结构债

结构债不是“有 bug”，而是当前结构让后续改动的成本高于必要水平。

例：

- 一个 3,000 行组件能正常工作，但每次加参数都要读完整组件；
- 一个 Store 能正常发请求，但凭证、模型和路由全在一个文件；
- 一个页面能正常展示，但业务顺序和 UI 事件混在一起。

### 4.2 隐式耦合

隐式耦合是指代码没有通过明确接口，却仍然互相影响。常见形式：

- 多个模块读取同一份可变对象；
- 一个模块修改另一个模块假设的状态；
- 通过闭包快照做读改写；
- 依赖固定调用顺序但顺序没有集中负责人；
- 用全局 `window`、`document` 或单例偷偷通信；
- fire-and-forget Promise 在后台修改状态；
- 事件发送者不知道谁会处理；
- 写完一部分状态后，另一模块再从当前快照补全。

隐式耦合会让“看起来只改一个文件”的变动影响整条业务链。

### 4.3 门面

门面是领域对外的稳定入口。

例如：

```text
ChannelFacade
  ├─ 凭证模块
  ├─ 模型目录
  ├─ 路由策略
  ├─ 协议目录
  └─ 生成客户端
```

外部只调用 `ChannelFacade`，不 import 内部小模块。

### 4.4 编排器

编排器按一个业务用例控制顺序和收口。

它负责：

- 先做什么，后做什么；
- 哪里开始事务；
- 哪里提交；
- 失败时回滚还是保留；
- 错误向谁汇报；
- 哪个状态是唯一真相。

它不负责：

- 拼 JSX；
- 写 SQL；
- 解析第三方响应字段；
- 保存第二份业务状态；
- 代替底层模块完成具体算法。

### 4.5 公共层不等于单文件

“渠道做成中央公共层”是正确的。  
“渠道所有实现都放在一个 1,802 行文件”不是公共层的必然要求；第一批已缩到 1,595 行。

公共层可以是一个很小的门面，背后有多个内部模块。

---

## 五、总体目标结构

### 5.1 推荐目录模板

```text
feature/
  index.ts                         # 仅导出稳定公共接口
  application/
    useCaseOrchestrator.ts         # 用例顺序、事务、错误收口
    ports.ts                       # 外部能力接口
    contracts.ts                   # 输入输出契约
  domain/
    types.ts                       # 领域数据结构
    rules.ts                       # 无副作用规则
  state/
    store.ts                       # 唯一状态真相
    selectors.ts                   # 只读派生
  infrastructure/
    repository.ts                  # 持久化
    providerAdapter.ts             # 第三方网络与响应格式
  ui/
    PageShell.tsx                  # 页面壳
    panels/                        # 按子页面拆
    hooks/                         # UI 适配，不拥有业务真相
```

不是每个功能都需要全部目录。目录存在的前提是职责真实存在。

### 5.2 依赖方向

允许：

```text
UI -> Application -> Domain
Application -> Infrastructure ports
State -> Domain
```

禁止：

```text
Domain -> UI
Domain -> State
Domain -> Infrastructure
Infrastructure -> Application
子模块 -> 兄弟子模块内部
外部页面 -> Infrastructure 内部实现
```

### 5.3 一个业务用例只有一个顺序负责人

推荐：

```text
Entry / PageShell
      ↓
UseCaseOrchestrator
      ├─ Query module
      ├─ Command module
      ├─ Repository port
      ├─ Execution port
      └─ Result presenter
```

禁止：

```text
组件 A -> 回调 B -> 子 hook C -> store D -> 事件 E -> 又回调 A
```

如果一条顺序需要跳五个文件才能看清，说明顺序负责人缺失。

---

## 六、两个大文件有关联时怎么处理

不是所有关联都要新增第三个“总管”。

### 6.1 单向依赖

```text
SettingsPage
  └──> ChannelFacade
          ├─ credentials
          ├─ protocolCatalog
          ├─ modelCatalog
          ├─ routingPolicy
          └─ generationClient
```

设置页拆成多个 Tab；渠道层拆成内部模块；设置页只依赖 `ChannelFacade`。

不新增共同编排层。

### 6.2 双向业务协作

```text
EcommercePageShell
  └──> EcommerceWorkflow
          ├─ IntentPlanner
          ├─ TaskRepository
          ├─ ExecutionPort
          ├─ AssetPort
          └─ StudioPresenter
                   ↓
              EcommerceStudio
```

只有两个领域互相需要来回协作、共享顺序或共享事务时，才新增一个按用例命名的共同编排层。

禁止命名为 `CommonManager`、`WorkflowService`、`EcommerceManager`。应命名为：

- `runEcommerceGeneration`
- `planEcommerceIntent`
- `deleteProjectRuntime`
- `runAgentTurn`

### 6.3 共享状态

```text
FlowSurface             CanvasExecutionFacade
      \                       /
       \                     /
            CanvasStore
```

画布状态只有一份。  
FlowSurface 负责交互，ExecutionFacade 负责执行命令，二者都通过 Store 和明确契约协作。

不要为了拆分再复制一份节点状态或运行状态。

### 6.4 共享事务

```text
ProjectRuntimeFacade
  ├─ OperationLock
  ├─ PrepareRuntime
  ├─ CommitRuntime
  ├─ RecoveryRuntime
  └─ PendingSnapshot
```

事务边界保留在 Facade。内部模块可以被组合，但不能各自独立提交一半事务。

### 6.5 判断表

| 两个模块的关系 | 处理方式 |
| --- | --- |
| A 单向调用 B | A 依赖 B 的公共门面，不增加层 |
| A、B 双向协作 | 新增一个按业务用例命名的编排器 |
| A、B 共享状态 | 指定唯一 Store，不复制状态 |
| A、B 共享事务或顺序 | 顺序和事务只放一个编排器 |
| A、B 只共享数据结构 | 抽共享类型或领域契约，不新增编排层 |
| A、B 互相 import 内部模块 | 立即停止，说明边界错误 |

---

## 七、重点模块拆分方向

### 7.1 渠道公共层

当前：

```text
channelStore.ts
  渠道 CRUD + Token + 凭证组 + 协议 + 模型 + 路由 + 配方
  + Store 请求编排（上下文/素材注入、RunRecord 包装）

src/platform/generation/generationClient.ts
  已有生成客户端：选凭据组、读 Key、映射模型、创建并调用协议适配器
```

目标：

```text
channelStore.ts                  # 薄门面，对页面/Agent/电商暴露稳定 API
channelRepository.ts             # 渠道记录
channelCredentials.ts            # Token、凭证组、优先级
channelProtocols.ts              # 内置/自定义协议
channelModelCatalog.ts           # 全局模型、分类、映射
channelRouting.ts                # 候选、策略、权重、故障转移
channelRecipes.ts                # 默认配方和记忆
channelRequestOrchestration.ts   # completeWithTools 的上下文、素材与 RunRecord 编排
channelImporter.ts               # 导入、探测、刷新模型

src/platform/generation/generationClient.ts
  继续作为唯一生成客户端；复用，不另建第二套
```

边界：

- `channelStore` 只组合模块并维护状态；
- 生成请求继续复用 `src/platform/generation/generationClient.ts`。它负责选组、读 Key、
  模型映射和适配器调用；`channelStore.completeWithTools` 仍承担上下文、素材注入和
  RunRecord 包装，因此下一步要拆的是 **Store 请求编排**，不是另建 generation client；
- 凭证模块不生成图片；
- 路由模块不发请求；
- 适配器不修改渠道记录；
- 页面不能直接 import 内部仓储；
- API Key 只能经凭证模块读写。

### 7.2 上游适配器

`openaiImages.ts` 不是继续按行切，而是按协议和职责切：

```text
imageAdapterRegistry.ts
chatImageProtocol.ts
openAiImageProtocol.ts
geminiImageProtocol.ts
soonStudioProtocol.ts
imageResponseDecoder.ts
imagePolling.ts
imageErrorMapper.ts
```

边界：

- 协议模块只解析自己格式；
- 轮询模块只负责异步任务；
- 错误映射模块只把上游错误转为应用错误；
- Registry 只选择适配器；
- 任何适配器都不能直接改 UI 或 Store。

### 7.3 设置页

目标：

```text
SettingsPage.tsx                 # 页面壳、Tab 路由
useSettingsNavigation.ts
settings/
  ChannelSettingsTab.tsx
  CredentialSettingsTab.tsx
  ModelMappingTab.tsx
  RoutingPolicyTab.tsx
  AppearanceSettingsTab.tsx
  SystemSettingsTab.tsx
components/
  ChannelTokenField.tsx
  ChannelAvatar.tsx
  ModelMappingRow.tsx
```

边界：

- Tab 只负责自己的 UI；
- 设置页壳不执行渠道请求；
- Token 输入组件只接收值和回调；
- 路由策略 UI 不直接读渠道存储；
- 所有持久化仍走 Channel/Setting Facade。

### 7.4 电商 Studio

目标：

```text
EcommerceStudio.tsx             # 组合根
studio/
  StudioModeTabs.tsx
  ProductModeForm.tsx
  PersonModeForm.tsx
  WearModeForm.tsx
  WhiteBackgroundForm.tsx
  VideoModeForm.tsx
  ResultPreview.tsx
  GenerationStageView.tsx
  modeParameterSchema.ts
  formMappers.ts
```

边界：

- Studio 只负责表单和展示；
- 计划、执行、任务保存由 `EcommerceWorkflow` 管；
- 每种模式的字段映射独立；
- 组件不直接发渠道请求；
- 组件不直接写任务仓储。

### 7.5 电商页面和工作台

目标：

```text
EcommercePage.tsx                 # 路由和页面壳
application/
  planEcommerceConversation.ts
  runEcommerceGeneration.ts
  loadEcommerceWorkspace.ts
  saveEcommerceDraft.ts
EcommerceWorkbench.tsx            # 工作台组合根
workbench/
  WorkbenchViewport.ts
  WorkbenchSelection.ts
  WorkbenchDrag.ts
  WorkbenchResize.ts
  WorkbenchMinimap.ts
  WorkbenchTaskProjection.ts
  WorkbenchToolbar.tsx
```

边界：

- 页面不解析画布内部鼠标事件；
- 工作台不规划电商意图；
- 任务结果真相仍在 Repository；
- 执行失败和重试由 Workflow 收口。

### 7.6 画布执行

```text
CanvasExecutionProvider.tsx       # 公共 Provider 和 API 门面
execution/
  executionHost.ts
  runPlanner.ts
  runLoop.ts
  textCompletionRunner.ts
  skillRunner.ts
  composeRunner.ts
  nodeRunner.ts
  groupRunner.ts
  runRecorder.ts                  # 第一刀
  runPreflight.ts                 # 第二刀；先修取消信号与失败状态
  cancelRuntime.ts
```

边界：

- Provider 只组装 API 和生命周期；
- 第一刀先抽 `runRecorder`；`runPreflight` 排在其后，并先修分支取消信号与路由失败状态；
- preflight 不发请求；
- runLoop 不拼 UI；
- runRecorder 不改变执行顺序；
- cancel 只通过 Runtime 控制；
- 所有付费请求必须经过现有执行入口和确认语义；
- 不能用拆分改变重试、扣费、取消和恢复顺序。

### 7.7 画布表面

```text
FlowSurface.tsx                   # 组合根
flow/
  FlowViewportController.ts
  FlowNodeProjection.ts
  FlowEdgeProjection.ts
  useSurfaceDrag.ts
  useSurfaceMarquee.ts
  useSurfaceContextMenu.ts
  useSurfaceImport.ts
  useSurfaceKeyboard.ts
  FlowHud.tsx
```

边界：

- 投影模块只把 Graph 转为 React Flow 数据；
- 拖拽模块只产生 Store 命令；
- 框选模块只管理选择状态；
- 导入模块只调用统一导入端口；
- 执行逻辑仍通过 `CanvasExecutionApi`。

### 7.8 项目运行态

```text
ProjectRuntimeRegistry.ts         # 操作门面
runtime/
  projectRuntimeSnapshots.ts      # 第一刀
  projectOperationLock.ts         # 第二刀
  projectRuntimeTransactions.ts   # 后续：唯一事务协调器，非三个独立 owner
```

边界：

- Registry 统一控制阶段；
- 先修 pending 订阅回调异常隔离，再抽快照；快照之后才动锁；
- commit/rollback/recovery 必须由同一个事务协调器掌握，不能拆成三个各自提交、回滚或恢复的
  transaction owner；`disposeProjectRuntimes` / `disposeAllProjectRuntimes` 也必须纳入同一套
  生命周期与 cleanup 语义；
- Lock 只判断占用；
- Prepare 只准备，不提交；
- Commit 只执行已准备事务；
- Recovery 只在定义阶段接管；
- Snapshot 只生成订阅快照；
- 子模块不能绕过 Registry 直接删注册或释放锁。

### 7.9 Agent 剩余优化

Agent 当前不是最优先，但继续遵守：

- `AgentPanel.tsx` 只装配；
- session/turn model 只接控制器；
- 纯逻辑不进 Hook；
- 工具入口不重新容纳计划校验和画布变更实现；
- CSS 按组件所有权分片；
- 每个拆分继续降低预算，不把阈值调高。

---

## 八、拆分完成后的行为边界

每个模块必须能回答四个问题：

1. 我拥有什么状态？
2. 我允许执行什么副作用？
3. 我的失败由谁收口？
4. 谁可以依赖我的公共接口？

建议在模块头注释中固定：

```text
Owns:
  - 本模块拥有的状态和规则
Does not own:
  - 明确禁止承担的职责
Public API:
  - 允许外部调用的方法
Forbidden imports:
  - 禁止依赖的层
Failure:
  - 错误如何返回，事务由谁收口
```

### 8.1 UI 模块

可以做：

- 渲染；
- 收集输入；
- 调用传入回调；
- 展示 loading/error/disabled。

不可以做：

- 直接访问数据库；
- 直接发渠道请求；
- 复制业务状态；
- 决定 Job 转态；
- 绕过编排器调用底层仓储。

### 8.2 Store

可以做：

- 持有唯一状态；
- 提供原子 action；
- 提供订阅和 selector。

不可以做：

- 解析 UI 事件；
- 拼页面文案；
- 直接决定重试策略；
- 持有第二份派生状态。

### 8.3 Repository

可以做：

- 行映射；
- 事务；
- 迁移；
- 持久化校验。

不可以做：

- 发渠道请求；
- React 状态；
- 页面导航；
- 决定业务重试。

### 8.4 Provider Adapter

可以做：

- 请求；
- 轮询；
- 响应解析；
- 错误归一化。

不可以做：

- 修改 UI；
- 修改业务 Store；
- 决定用户是否确认；
- 写任务结果以外的业务表。

### 8.5 编排器

可以做：

- 顺序；
- 事务开始/提交；
- 条件分支；
- 取消和恢复；
- 错误收口。

不可以做：

- 持有第二份长期状态；
- 实现所有子模块算法；
- 变成新的 2,000 行文件。

---

## 九、拆分前如何冻结现有行为

任何大拆分都不能直接“先拆再测”。必须先建立行为基线。

### 9.1 建行为清单

每个待拆模块先列出：

- 正常路径；
- 空数据；
- 缺配置；
- 并发；
- 用户取消；
- 网络失败；
- 存储失败；
- 页面关闭；
- 重载恢复；
- 重复点击；
- 旧数据迁移。

### 9.2 先补特征测试

特征测试的目的不是“增加覆盖率”，而是固定现有行为。

需要固定：

- 调用顺序；
- 输出值；
- Store 写入；
- 数据库事务；
- Job/状态变更；
- 错误文案和错误类型；
- 是否创建付费请求；
- 是否保留队列；
- 是否清空附件；
- 是否恢复旧状态。

### 9.3 记录不允许变化的行为

例如：

- `applyPlan` 先落库还是先发请求；
- 停止任务先 abort 还是先 settle；
- 队列完成后才删队首；
- 确认成功后才清 pendingConfirmation；
- 关闭面板后 fire-and-forget 任务是否允许继续；
- 编辑器焦点、滚动和快捷键；
- DOM 锚点和 CSS 类名。

这些顺序必须由测试固定，不能只写在注释里。

---

## 十、拆分后的验证矩阵

### 10.1 通用验证

每个拆分提交至少通过：

```text
npx tsc --noEmit
npm run check
定向 Vitest
全量 Vitest
npm run build
git diff --check
HeadCheck <commit>
```

高风险模块还要跑真实流程和失败注入。

### 10.2 纯函数

- 输入/输出表驱动测试；
- 边界值；
- 空值、坏数据、非法数据；
- 同一输入多次调用结果一致；
- 无隐藏状态和顺序依赖。

### 10.3 Store / Repository

- 真实内存存储；
- 真实事务；
- 并发写入；
- 旧数据迁移；
- 冲突与 revision CAS；
- 不存在的行；
- 写入失败回滚；
- 重复执行幂等；
- 读取和写入顺序。

### 10.4 Hook / Controller

- 首次渲染；
- 会话切换；
- 卸载；
- 依赖稳定；
- 回调只触发一次；
- 失败不误报；
- 关闭后不再写状态；
- 同一能力只实例化一次。

### 10.5 UI

- 1440x900；
- 1024x700；
- 明暗主题；
- 文字不溢出；
- 键盘焦点；
- hover/disabled/loading；
- 关键 DOM 锚点；
- 页面截图对比；
- 不改变现有交互顺序。

### 10.6 Agent 高风险链路

每次涉及 Agent 结构时，重点验证：

- 用户消息先落库；
- 路由成功后创建 Job；
- 停止后不再发请求；
- 取消、确认、继续只收口一次；
- 队列项不会执行两遍；
- 切会话后旧回合不能覆盖新会话；
- 面板关闭和恢复；
- 附件原子追加；
- revision CAS；
- Workbuddy/Chat2api 可用性按真实验收记录。

### 10.7 渠道高风险链路

- 渠道 CRUD；
- Token 永不进日志；
- 凭证组优先级；
- 模型映射；
- 路由候选；
- 故障转移；
- 超时与取消；
- 不同协议响应解析；
- 上游错误结构化；
- 旧配置迁移；
- 设置页保存后 Agent/电商/画布读取一致。

### 10.8 画布执行高风险链路

- 单节点运行；
- 整组运行；
- runFrom；
- 取消；
- 失败恢复；
- 重试不重复扣费；
- runRecord 与资产写入一致；
- 删除项目时运行态释放；
- 路由卸载后 host/runtime 不泄漏。

### 10.9 电商高风险链路

- 意图解析；
- 计划预览；
- 草稿保存和恢复；
- 批量生成；
- 单张失败重试；
- 结果仓储；
- 排队素材保存；
- 项目切换；
- 工作台结果回填；
- 不重复创建节点或结果行。

### 10.10 如何识别假绿

至少做一次变异检查：

- 临时删掉关键判断；
- 确认对应测试变红；
- 恢复判断；
- 确认测试变绿；
- `git diff` 确认恢复无误。

覆盖率上升但关键分支没有行为断言，不算验证完成。

---

## 十一、门禁设计

### 11.1 现有门禁继续保留

- TypeScript；
- ESLint；
- dependency-cruiser；
- architecture rules；
- 文档索引和迁移；
- Agent 行数棘轮；
- 公共导出身份测试；
- 全量测试和构建。

### 11.2 新增领域预算

建议目标：

| 类型 | 目标 | 警戒 | 强制拆分 |
| --- | ---: | ---: | ---: |
| 入口/组合根 | 100–200 | 300 | 300+ |
| 普通 UI 组件 | 200–500 | 700 | 800+ |
| Hook/Controller | 300–600 | 800 | 900+ |
| Store/Repository | 400–800 | 1,000 | 1,000+ 需说明 |
| 纯算法 | 200–500 | 800 | 900+ |
| CSS Module | 200–600 | 1,000 | 1,000+ 需按组件拆 |
| 类型/配置/生成数据 | 例外 | 看职责 | 不作行数强制 |

行数不是唯一标准，但超过警戒线必须进入审查。

### 11.3 文件预算必须按目录覆盖

不能只限制一个具名文件。应采用：

```ts
const MODULE_BUDGETS = {
  'AgentPanel/*.ts': 850,
  'AgentPanel/*.tsx': 850,
  'ecommerce/**/*.tsx': 850,
  'settings/**/*.tsx': 850,
  'canvas/execution/**/*.ts': 850,
  'channel/**/*.ts': 850,
}
```

真实实现可以在结构测试里用 `import.meta.glob('?raw')` 读取源码，避免引入 Node 类型依赖。

### 11.4 预算只许下降

规则：

- 拆分前实测 N 行；
- 拆分后实测 M 行；
- 新预算设为 `M + 40`；
- 下一刀继续下降；
- 不允许因为要加功能而调高预算；
- 如确实需要调高，必须先继续拆或给出书面例外并设置到期时间。

### 11.5 新文件必须登记职责

**2026-11-05 已落地**：`architecture/module-governance.json` 是机器可读登记源，
`scripts/check-module-governance.mjs` 已接入 `npm run check`。目录覆盖 `src/**`，相对
`3b13aca` 识别新文件；新 TS/TSX 默认预算 450，CSS 600，目录可进一步收紧。18 个超千行
TS/TSX 和 7 个超千行 CSS 逐项登记 legacy 实测上限，预算不得高于基线；拆小后允许下降。
正反样本见 `scripts/module-governance.test.mjs`。`publicApi` 的语义和导出身份仍须由行为测试验证，
登记字段本身不代替公共 API 快照。

新增生产文件时必须在架构登记表登记：

| 字段 | 说明 |
| --- | --- |
| module | 文件路径 |
| owner | 所属业务域 |
| responsibility | 一句话职责 |
| owns | 拥有的状态/能力 |
| does-not-own | 明确禁止的职责 |
| public-api | 对谁暴露什么 |
| test | 兄弟测试 |
| budget | 行数上限 |
| temporary | 是否有临时例外 |

没有登记的新模块不能通过架构测试。

### 11.6 导入方向门禁

必须禁止：

- `domain` import `ui`、`state`、`infrastructure`；
- `ui` 直接 import 其他域的 `infrastructure`；
- 子模块 import 兄弟子模块内部实现；
- Store 反向 import 页面；
- Adapter import 页面 Store；
- 跨域直接 import 非 `index.ts`/facade 文件；
- 循环依赖。

允许跨域时只通过公共门面和类型契约。

### 11.7 公共 API 快照

拆分前记录公共导出：

- 函数名；
- 类型名；
- 对外对象字段；
- re-export 来源；
- 兼容别名。

拆分后：

- 导出对象身份保持；
- `tsc` 外部调用零改动；
- 必要时用 `toBe` 验证 re-export 仍是同一实现；
- 不允许悄悄改变参数顺序和默认值。

### 11.8 状态所有权门禁

架构测试应检查：

- 同一个 per-session Map/Set 只有一个 `useRef` 创建点；
- 同一个业务状态只在一个 Store 中持有；
- UI 不创建业务 Store 副本；
- 编排器不保存第二份长期状态；
- 读取真相必须经过 owner。

### 11.9 测试兄弟文件门禁

规则：

- 纯逻辑模块必须有兄弟测试；
- 纯类型模块必须验证没有运行时导出；
- 新 Hook 必须有首次渲染、切换和卸载测试；
- 新 Repository 必须有真实存储和事务测试；
- 新 Adapter 必须有至少一个真实响应样例和失败样例。

### 11.10 防止“换个文件继续膨胀”

这是重点。

只给主文件设上限没有用，代码会搬进新文件继续长。应组合以下措施：

1. 目录级预算；
2. 新文件登记；
3. 总模块数预算；
4. 公共入口薄层限制；
5. 导出数量限制；
6. 单文件责任登记；
7. 拆分提交同步降低旧预算；
8. 全员可读的预算表；
9. 新文件默认更小预算，例如 300 或 450 行；
10. 发现 `common/`、`utils/`、`managers/` 无限扩张时要求按业务域命名。

### 11.11 防止拆分碎片化

也要防止过度拆分：

- 一个 10 行文件只为转发一个函数，通常不拆；
- 三个文件互相回调完成同一算法，应合并；
- 一个业务顺序需要超过 5 个短模块才能看懂，应增加编排器文档或合并；
- 拆分后总认知成本必须下降，不能只让文件数量上升。

### 11.12 建议门禁落地顺序

1. 先登记现有 legacy 大文件白名单；
2. 白名单预算只许下降；
3. 新文件默认强制预算；
4. 增加跨域导入规则；
5. 增加状态所有权检查；
6. 增加新文件职责登记；
7. 最后再把 legacy 文件逐个移出白名单。

不要第一天把所有历史文件打红，否则团队会选择关掉门禁。

---

## 十二、隐式耦合怎么完整去掉

### 12.1 先做耦合清单

每个待拆模块记录：

| 耦合 | 例子 | 风险 |
| --- | --- | --- |
| 共享可变状态 | 两个 hook 都改同一 Map | 后写覆盖 |
| 闭包快照 | 用旧 session 拼整行写回 | 丢新增字段 |
| 顺序耦合 | transition 必须先于 settle | 异常时锁泄漏 |
| 回调耦合 | 子组件回调依赖父层闭包 | 切会话后写错对象 |
| 全局对象 | 核心逻辑直接读 `window/document` | 不可测、不可复用 |
| 事件广播 | 发事件后不知道谁处理 | 顺序不明确 |
| 隐式单例 | 模块内缓存状态 | 多实例串味 |
| 重复派生 | 两处各自计算同一规则 | 结果不一致 |
| 双层缓存 | Store 和 hook 各存一份 | 读写不一致 |
| fire-and-forget | 后台 Promise 修改状态 | 关闭后仍写、错误无人接 |

### 12.2 改为显式依赖

用参数或端口传入：

```ts
interface ChannelCredentialPort {
  load(channelId: string, slot?: string): Promise<string | null>
  save(channelId: string, token: string, slot?: string): Promise<void>
  remove(channelId: string, slot?: string): Promise<void>
}
```

不要：

```ts
function someDeepModule() {
  return globalChannelStore.getState().channels[0].token
}
```

### 12.3 去掉重复状态

判断：

- 这个数据是不是业务真相？
- 它是否已经存在于 Store/Repository？
- 如果删除这份副本，是否只会让派生计算多一点，而不会丢语义？

如果是，删除副本，改为 selector 或局部视图状态。

### 12.4 状态写入只走原子 action

禁止：

```ts
const latest = await getSession(id)
await updateFields(id, { ...latest, pendingAssetIds: [...old, newId] })
```

应该：

```ts
await appendPendingAssetIds(id, newIds)
```

规则：

- 读改写在一个事务里；
- action 名体现业务意图；
- 不允许页面拼整行业务数据；
- 不允许旧渲染快照覆盖新状态。

### 12.5 用命令/查询替代隐形回调链

- Query：读取数据，不产生副作用；
- Command：产生明确写入或执行；
- Orchestrator：决定命令顺序；
- Event：只用于观察和通知，不承担核心事务顺序。

关键业务顺序不要用 Event Bus 隐藏。

### 12.6 异步任务必须有归属

所有脱离点击等待链的 Promise 必须满足：

- 被注册；
- 失败有 catch；
- 面板关闭后知道是否继续；
- 关闭后不会写 UI；
- 是否可取消明确；
- 不产生未处理 rejection。

### 12.7 事务边界不能跨模块随意拆

如果一段操作必须原子完成：

- 事务入口和提交点放在同一个 owner；
- 子模块接收事务上下文；
- 不能每个子模块自行提交；
- 失败时由 owner 统一 rollback 或恢复。

### 12.8 耦合清理顺序

1. 列出现有状态和副作用；
2. 标出唯一真相；
3. 找出重复读写点；
4. 建公共端口；
5. 把调用方改为端口；
6. 删除旧的后门；
7. 加行为测试；
8. 加导入门禁；
9. 最后删除旧实现。

不要先删旧实现再找漏网调用。

---

## 十三、标准拆分流程

每一刀按以下步骤执行，不跳步：

### 第一步：选边界

只选择一个真实业务边界，例如：

- 渠道凭证；
- 电商任务结果；
- 画布取消；
- 设置页 Tab。

不能写“重构电商”这种目标。

### 第二步：画依赖

列出：

- 谁调用它；
- 它调用谁；
- 读写哪些状态；
- 有哪些事务；
- 错误由谁处理；
- 哪些行为不能变。

### 第三步：冻结公共接口

- 保留原入口；
- 保留导出名；
- 保留参数结构；
- 保留默认值；
- 必要时加 re-export。

### 第四步：补特征测试

先证明现有行为，不先改实现。

至少覆盖：

- 正常路径；
- 失败路径；
- 顺序；
- 事务；
- 取消；
- 并发；
- 恢复。

### 第五步：只搬一块

一次提交只搬一个有名字的职责。

禁止同时：

- 改 UI；
- 改业务规则；
- 改存储格式；
- 改错误文案；
- 大范围重命名。

### 第六步：保持外部调用不变

外部调用方应尽量零改动。  
如果需要改很多调用方，说明公共门面没有设计好。

### 第七步：验证

至少：

- 定向单元测试；
- 真实装配测试；
- 全量测试；
- `tsc`；
- `npm run check`；
- `npm run build`；
- `HeadCheck`。

涉及 UI 时加截图和真实操作。

### 第八步：收紧预算

拆分后同步降低旧文件预算，并给新模块设定预算。  
不能只拆文件不设上限。

### 第九步：更新文档

更新：

- 架构模块索引；
- 职责与禁止项；
- 对账清单；
- 操作教训；
- 如有新顺序，补 INVARIANTS。

### 第十步：提交

一个可回滚的职责拆分一个 commit。  
禁止把无关改动混进同一个拆分提交。

---

## 十四、新功能开发流程

以后新增功能按以下顺序判断：

1. 属于哪个业务域？
2. 由哪个唯一状态源持有状态？
3. 是一个 Query、Command 还是完整 Use Case？
4. 是否需要跨两个域？
5. 跨域是单向、双向、共享状态还是共享事务？
6. 应扩展门面、增加命令，还是新建编排器？
7. 是否需要先拆现有大文件？
8. 先写哪些行为测试？
9. 新文件归谁所有，预算多少？
10. 如何证明没有复制状态和绕过门面？

### 14.1 何时允许新增文件

只有满足一个条件：

- 新职责；
- 新协议；
- 新用例；
- 新状态 owner；
- 新 UI 子页面；
- 新持久化边界。

不能因为“文件太大”随手新增 `utils2.ts`。

### 14.2 何时不需要新增文件

- 只是同一算法的小函数；
- 只是纯类型别名；
- 只是单行转发；
- 只是已有模块的私有 helper；
- 拆出去反而需要暴露内部类型和更多端口。

### 14.3 新功能提交清单

- [ ] 没有修改无关大文件；
- [ ] 新逻辑放在所属域；
- [ ] 没有复制 Store 状态；
- [ ] 没有跨域 import 内部模块；
- [ ] 没有新增隐式全局对象；
- [ ] 顺序和事务有唯一 owner；
- [ ] 新文件已登记职责和预算；
- [ ] 有兄弟测试；
- [ ] 有失败路径；
- [ ] 全量门禁通过；
- [ ] 文档已同步。

---

## 十五、文档治理

现有文档体系很好，但需要降低查找成本。

当前问题：

- `轻画-功能对账清单.md` 已超过 2 MB；
- `轻画-架构设计文档.md` 已接近 400 KB；
- 当前真相、历史批次、实施细节、验收证据混在长文件中；
- 新会话需要先读大量历史才能找到当前状态。

建议逐步拆成：

```text
ACTIVE-GAPS.md              # 当前未完成事项、优先级、负责人、证据
ARCHITECTURE-CURRENT.md     # 当前架构图、模块边界、依赖方向
ADR/                        # 每个关键决策一份短记录
HISTORY/                    # 已验收批次和事故证据
MEMORY.md                   # 操作教训
INVARIANTS.md               # 不可破坏的行为顺序
```

迁移原则：

- 不删除历史；
- 当前真相仍只有一个入口；
- 历史记录只追加；
- 架构正文只描述当前状态；
- 决策记录写背景、选择、替代方案、后果；
- 对账清单保留编号索引，不再无限堆工程细节。

在完成迁移前，本文不要求重写现有文档，只要求新增架构决策时优先写短文档。

---

## 十六、优先级路线

### P0：高风险状态机

1. `CanvasExecutionProvider`
2. `ProjectRuntimeRegistry`
3. `channelStore`

先补行为特征测试，再拆。  
这些模块影响扣费、停止、恢复、删除和渠道路由，不能先改结构后补测试。

### P1：长业务链

1. `EcommercePage`
2. `EcommerceStudio`
3. `ecommerceTaskRepository`
4. `EcommerceWorkbench`
5. `openaiImages`

优先抽共同编排层和稳定契约，再拆 UI。

### P2：开发效率型结构债

1. `SettingsPage`
2. `CreationPanel`
3. `FlowSurface`
4. `LightboxLayer`
5. 项目页和项目树

按下一次真实需求触及时拆，不为了行数立即全拆。

### P3：Agent 收尾

- 继续保持 session/turn model 变薄；
- 大 CSS 按组件所有权拆；
- 不再为了追求 300 行制造过多端口。

### P4：文档瘦身

- 先建立当前缺口视图；
- 再迁移历史批次；
- 最后整理架构正文和 ADR。

---

## 十七、如何证明“业务逻辑和功能逻辑保持现有状态不变”

必须同时满足以下证据：

### 17.1 代码证据

- 公共导出名不变；
- 参数和返回类型不变；
- 外部调用方没有被迫大改；
- 事务顺序不变；
- 状态 owner 没变；
- 没有重复状态；
- 没有新循环依赖；
- 没有 UI 逻辑进入领域层。

### 17.2 测试证据

- 特征测试在拆分前通过；
- 拆分后同一测试继续通过；
- 关键守卫经过变异测试；
- 全量测试通过；
- 构建通过；
- HeadCheck 通过。

### 17.3 运行证据

高风险模块需要：

- 真实 Store；
- 真实事务；
- 真实 Provider；
- 真实失败注入；
- 真实恢复流程；
- 必要时真实渠道或真实桌面壳。

### 17.4 UI 证据

涉及 UI 时必须：

- 1440x900；
- 1024x700；
- 明暗主题；
- 关键流程截图；
- 键盘与焦点；
- 文本不溢出；
- DOM 锚点不变；
- console/page error 为零。

### 17.5 文档证据

- 对账清单记录拆分前后；
- 架构文档记录新边界；
- MEMORY 记录踩坑；
- INVARIANTS 记录不可变顺序；
- 公共 API 兼容说明。

### 17.6 不允许的“完成”证据

以下都不够：

- 只是 `tsc` 通过；
- 只是行数变小；
- 只是文件数量变多；
- 只是单测通过但没有真实装配；
- 只是截图没有断言；
- 只是覆盖率上升；
- 只是 Agent 自己声明完成。

---

## 十八、完成定义

一个拆分任务完成，必须同时满足：

- [ ] 责任边界能用一句话说清；
- [ ] 新模块知道自己拥有和禁止什么；
- [ ] 公共入口保持兼容；
- [ ] 状态只有一个 owner；
- [ ] 顺序和事务只有一个 owner；
- [ ] 子模块不反向依赖；
- [ ] 无兄弟模块内部 import；
- [ ] 新文件已登记职责；
- [ ] 文件预算已收紧；
- [ ] 定向测试通过；
- [ ] 全量测试通过；
- [ ] `check` 通过；
- [ ] `build` 通过；
- [ ] HeadCheck 通过；
- [ ] 高风险流程有真实证据；
- [ ] UI 有截图和交互证据；
- [ ] 文档、MEMORY、INVARIANTS 已更新；
- [ ] 提交可独立回滚。

只有这些全部成立，才能说“拆分完成且行为未变”。

---

## 十九、最终原则

### 原则 1

不是所有大文件都立刻拆。  
经常改、影响大、职责混、测试弱的先拆。

### 原则 2

公共层要保留，内部实现要分层。  
不能把“中央公共层”变成“中央巨型文件”。

### 原则 3

拆分不是把代码切碎，而是把责任和顺序变清楚。

### 原则 4

一个业务用例只有一个顺序负责人。  
一个状态只有一个真相源。

### 原则 5

大文件之间的联系不靠互相 import 维护，而靠门面、契约、Store 和编排器维护。

### 原则 6

门禁必须按目录覆盖，不能只限制一个主文件。  
否则代码只会换个文件继续长大。

### 原则 7

拆得对，系统更可控；拆得碎，系统更混乱。  
判断标准是认知成本和变更风险是否下降，不是文件数量是否增加。

### 原则 8

任何高风险拆分，先固定行为，再移动代码。  
没有证据的“应该没变”不算验收。

---

## 二十、短期执行建议

接下来不要同时大拆五块。按单一切口推进：

1. 先做架构预算和职责登记门禁，防止边拆边膨胀。
2. `channelStore` 凭证第一刀已完成；下一步拆 Store 请求编排，继续复用现有 generation client，
   不另建第二套。
3. `ProjectRuntimeRegistry` 的订阅异常隔离和快照第一刀已完成；下一步拆锁，
   commit/rollback/recovery 保持单一事务 owner，dispose 一并纳入语义。
4. `CanvasExecutionProvider` 的 `runRecorder` 第一刀已完成；下一步 `runPreflight`，
   并先修取消信号与失败状态。
5. 每刀完成后立即收紧预算，再进入下一个。
6. 电商和设置页不先做一次性大重构，等真实需求触及时按 Tab、模式和业务用例拆。

这条路线能避免两件事：

- 为了追求短期全绿而不敢动结构；
- 为了追求结构完美而一次性重写，造成功能回归。

最终目标不是“没有大文件”，而是：

> 每个文件都有明确责任，每条业务链都有唯一顺序负责人，每个状态都有唯一真相源，每个新功能都有明确落点，每个拆分都有可重复的验收证据。
