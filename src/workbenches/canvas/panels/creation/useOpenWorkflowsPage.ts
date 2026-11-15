import { useCallback } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { workflowsPagePath, type WorkflowsPageQuery } from '../../../../domain/project/workflowsPage'

/** 条目下拉 / 入口 chip 里那一行「管理 AI 应用 / 工作流…」的选项值 */
export const MANAGE_WORKFLOWS_OPTION = '__manage-workflows__'

/**
 * 从创作面板跳到「AI 应用 / 工作流」页（#1131）。
 *
 * 面板也会在没有路由的地方渲染（单测的静态渲染、预览页），那里退回整页跳转，
 * 而不是让 `useNavigate` 在路由外直接抛错。
 */
export function useOpenWorkflowsPage(): (query?: Partial<WorkflowsPageQuery>) => void {
  /* 同一个组件里「在不在路由里」整个生命周期不变，条件调用 hook 是安全的 */
  const navigate = useInRouterContext() ? useNavigate() : null
  return useCallback(
    (query: Partial<WorkflowsPageQuery> = {}) => {
      const path = workflowsPagePath(query)
      if (navigate) navigate(path)
      else if (typeof window !== 'undefined') window.location.assign(path)
    },
    [navigate],
  )
}
