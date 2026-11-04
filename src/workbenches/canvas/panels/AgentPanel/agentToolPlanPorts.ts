import type { AgentTaskPlan } from '../../../../domain/agent/taskPlan'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'

export interface AgentToolPlanPortsInput {
  sessionId: string
  getSession: (sessionId: string) => Promise<AgentSession | null>
  updateFields: (
    sessionId: string,
    patch: { taskPlan: AgentTaskPlan },
  ) => Promise<AgentSession | null>
  trackRun: TaskLifecycle['track']
  setList: (
    update: (previous: AgentSession[]) => AgentSession[],
  ) => void
  setCurrent: (session: AgentSession) => void
  currentIdRef: { readonly current: string | null }
}

export interface AgentToolPlanPorts {
  get: () => Promise<AgentTaskPlan | undefined>
  save: (plan: AgentTaskPlan) => Promise<AgentTaskPlan | null>
}

/**
 * 工具层读写任务计划的端口（`AgentToolContext.taskPlan`）。
 *
 * 三条顺序是硬约束，改这里前先看 `agentToolPlanPorts.test.ts`：
 * 1. **先落库再投影**：`updateFields` 成功之后才动 `list` / `current`；
 * 2. **返回 null 就什么都不投影**，并且 `save` 也返回 `null`（调用方据此判断失败）；
 * 3. **只有目标仍是当前会话才 `setCurrent`**，否则只同步列表 ——
 *    切走的会话不能被一次保存把用户的界面拽回去。
 *
 * 整段必须走 `trackRun`：面板关闭后不许再写库。
 */
export function createAgentToolPlanPorts(
  input: AgentToolPlanPortsInput,
): AgentToolPlanPorts {
  return {
    get: async () =>
      (await input.getSession(input.sessionId))?.taskPlan,
    save: (plan) =>
      input.trackRun(async () => {
        const next = await input.updateFields(input.sessionId, {
          taskPlan: plan,
        })
        if (next) {
          input.setList((prev) =>
            prev.map((item) =>
              item.id === next.id ? next : item,
            ),
          )
          if (input.currentIdRef.current === next.id) {
            input.setCurrent(next)
          }
        }
        return next?.taskPlan ?? null
      }),
  }
}
