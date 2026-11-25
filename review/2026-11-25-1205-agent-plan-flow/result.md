# #1205–#1206 Agent 计划验收与滚动收口

- 范围：Agent 计划卡流程、验收状态、视觉验收过程文案与单层滚动。
- 根因：自动模式代点 `requestTaskConfirmation(purpose=review)`；autoRun 提示与任务计划验收规则冲突；未来步骤继承当前步骤验收标签；`planDock` 与步骤列表各自纵向滚动。
- 修复：review 改为用户亲自确认；只有当前步骤显示 `完成需验收`；`needs_changes` 显示 `视觉验收需修改`；计划卡移入 `[data-agent-content]`，只保留内容区一层滚动。
- 结构：`readableConfirmationLines` 拆到 `agentConfirmationText.ts`，`conversation.ts` 回到 984 行并登记模块治理。
- 证据：`G1205` 四组合 `4/4`，`G800` 四组合 `4/4`；全量 Vitest `6697 passed / 1 skipped`；`npm run check` 与 `npm run build` 通过。
