# Agent 电商流程修复（#1208–#1215）

## 范围

涉及 Agent 逻辑与 UI。覆盖自动 Skill、电商文字排版、套图锚点、问题卡文案、图片调研目标与来源原因、参考分析阻塞、工具结果前状态文案。

## 实现

- 显式 Skill chip 最高优先；无 chip 时由 `chooseAgentSkillsForTurn()` 从用户技能库确定性匹配。
- 电商任务写入统一比例、锚点和文字排版约束；`applyPlan` 与付费前都做确定性检查。
- 问题卡可见正文按真实题数生成。
- 图片调研默认 100、允许 100–120；展示实际检索词、目标 / 实收和各站原因。
- 显式参考分析失败写 `blockedIds`，阻止 `applyPlan / runNode / runFrom`；明确跳过后写 `skippedIds`。
- `runNode` 结果返回前显示“等待确认后生成”。

## 验证

- 全量 Vitest：`6734 passed / 1 skipped`。
- G1205：`1440×900 / 1024×700 × 明暗` 四组合均 `6/6`。
- `npm run check` 通过。
- `npm run build` 通过。
- Impeccable detector：`[]`。

## 截图

- 计划卡改动前基线：`before/{1440x900,1024x700}-{light,dark}.png`
- `after/1205-agent-plan-light-1440.png`
- `after/1205-agent-plan-dark-1440.png`
- `after/1205-agent-plan-light-1024.png`
- `after/1205-agent-plan-dark-1024.png`
- `after/1205-agent-research-light-1440.png`
- `after/1205-agent-research-dark-1440.png`
- `after/1205-agent-research-light-1024.png`
- `after/1205-agent-research-dark-1024.png`

调研状态面板是本次新增界面，没有可比的旧组件；以四组合 after 截图和 G1205 断言作为验收证据。
