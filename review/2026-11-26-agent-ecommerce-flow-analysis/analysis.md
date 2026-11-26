# 电商 Agent 工作流问题分析

## 结论

九个现象归到五条主链：

1. 请求分类没有稳定识别电商套图，任务计划与用户验收没有进入。
2. Skill 只能由 chip 显式注入，Agent 不能搜索用户库。
3. 计划落地缺少统一比例、文字排版和套图锚点的确定性检查。
4. 研发调研的词、来源和失败原因没有形成可解释的完整 UI。
5. 参考分析失败不阻塞，工具状态又在确认前提前显示完成。

## #1207 验收不可见

- `agentContextPolicy.ts` 的 `MULTI_STAGE_PATTERN` 没有覆盖“电商主图 / 商品套图 / 多张主图”。
- 带图请求可能进入 `reference_edit`，而 `toolCatalog.ts` 的 `REFERENCE_EDIT_TOOLS` 不包含任务计划三件套。
- `requestTaskConfirmation` 必须绑定计划 `stepId`，没有计划时无法生成用户验收卡。
- `visualReview` 是只读子代理检查，不是用户验收。
- 建议：电商套图稳定判为 `complex_plan`；复杂流未建计划前禁止直接 `applyPlan`。

## #1208 Skill 不自动加载

- `agentTurnRequest.ts` 只把本轮 skill chip 交给 `resolveAgentSkillsForTurn`。
- 会话 `skillId` 没有 chip 也不注入；`allSkills` 不进入模型可见上下文。
- 工具目录没有搜索 / 读取 Skill 的能力。
- 建议：回合准备阶段做本地 Skill 检索；或提供只读 `searchSkills / loadSkill` 工具。显式 chip 优先，自动命中显示真实技能名。

## #1209 文字排版缺失 / #1210 锚点不统一

- 文字排版、主图组合、卖点层级规则主要在 `image-ecommerce` Skill；Skill 未加载时通用链没有同等硬约束。
- `seriesAnchors.ts` 只覆盖 Logo → 包装 → 海报；五张主图通常都判为 poster，不会形成派生锚点。
- 建议：加载电商 Skill 后生成固定结构：产品锚点 / 首屏 KV → 卖点图与详情派生图；计划门禁检查文字字段和上下游连线。

## #1211 比例不一致

- 计划落地合并会保留每个节点自己的 `data.ratio`，没有“用户要求统一 1:1 时全组必须相等”的检查。
- 运行记录虽然保存 requested / output 尺寸，但成功收口没有比较实际比例。
- 建议：`planProblems` 增加比例一致性；运行完成后按容差检查 `naturalSize`，异常时给明确告警而不是静默成功。

## #1212 问题卡文案错位

- `questionCardText()` 只剥离题目回显，不检查模型 intro 中的题数、执行承诺或出图数量。
- 建议：问题卡引导由真实题数确定性生成，如“先确认这 3 项”；删除“几件事定了就一次出 N 张”这类承诺。

## #1213 调研词与来源原因

- 查询词来自模型自由生成，`researchQueriesOf()` 只做 trim / 去重，没有电商中文平台模板。
- `siteStatuses` 已包含失败原因，但 `AgentPanel` 没有消费；图片模式收尾正文又被隐藏。
- 建议：增加电商查询画像（淘宝/京东风格、中文/英文双轨）；结果卡展示每站数量与 blocked / needs-login / timeout / empty 原因。

## #1214 图片数量

- `designResearch.ts` 和工具 schema 都把 `imageMaxResults` 限制在 30–50。
- 建议：默认目标 100，补多页与额外检索角度；来源不足时显示目标值、实收值和原因。

## #1215 参考失败与提前完成

- `reviewTurnReferences()` 失败后只记录 warning；`agentTurnRequest.ts` 仅 notify，不阻止后续 `applyPlan`。
- `conversation.ts` 在只看到工具调用、还没有结果或仍在等待确认时就用完成态 label；`runNode` 因而提前显示“已运行生成”。
- 建议：显式参考分析失败时进入重试 / 跳过确认门禁；工具卡在结果回来前显示“等待确认 / 准备生成 / 正在创建”。

## 建议修复顺序

1. #1207 + #1215：先让计划、验收和真实工具状态一致。
2. #1208–#1210：自动 Skill、文字门禁、电商锚点。
3. #1211 + #1212：比例硬门禁与问题卡文案。
4. #1213 + #1214：调研查询质量、来源可解释与 100 张目标。

