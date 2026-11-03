import { projectRoute } from '../domain/shared/workbench'
import type { NavigateFunction } from 'react-router-dom'
import { clearAgentHandoff } from '../features/canvas/agentHandoff'
import { clearAgentSkillHandoff } from '../features/canvas/agentSkillHandoff'
import {
  activeCanvasId,
  forgetActiveCanvas,
} from '../state/project/activeCanvas'
import { forgetCanvasStore } from '../state/workbenches/canvas/storeCache'

/**
 * 项目从当前列表 / 回收站删除且数据库操作已成功后的统一收尾。
 *
 * 不能提前到 dispose 阶段：dispose 失败时项目仍然存在，内存里的 handoff 与
 * 当前画布身份也应保留，方便用户重试而不是被半清空。
 */
export function clearDeletedProjectState(projectId: string): void {
  clearAgentHandoff(projectId)
  clearAgentSkillHandoff(projectId)
  forgetCanvasStore(projectId)
  if (activeCanvasId() === projectId) forgetActiveCanvas()
}

export function clearDeletedProjectsState(
  projectIds: readonly string[],
): void {
  for (const projectId of new Set(projectIds)) {
    clearDeletedProjectState(projectId)
  }
}

export function isCanvasProjectPath(
  pathname: string,
  projectId: string,
): boolean {
  return pathname === projectRoute('canvas', projectId)
}

export function leaveDeletedCanvasRoute(
  pathname: string,
  projectId: string,
  navigate: NavigateFunction,
): boolean {
  if (!isCanvasProjectPath(pathname, projectId)) return false
  navigate('/projects', { replace: true })
  return true
}
