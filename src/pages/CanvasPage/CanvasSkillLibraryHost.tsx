import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeAgentSkillLibraryRequest } from '../../features/canvas/agentSkillHandoff'

const SkillLibraryOverlay = lazy(() =>
  import('./SkillLibraryOverlay').then((module) => ({ default: module.SkillLibraryOverlay })),
)

/**
 * 画布页里接住「Agent 技能按钮 → 打开技能库」的宿主：订阅本项目的请求，
 * 在画布舞台（`canvasStage`）里挂居中的技能库浮层。Agent 面板由 AppShell 常驻渲染，
 * 不在画布页子树里，所以经 `features/canvas/agentSkillHandoff` 的订阅通信。
 */
export function CanvasSkillLibraryHost({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  useEffect(
    () => subscribeAgentSkillLibraryRequest(projectId, () => setOpen(true)),
    [projectId],
  )
  useEffect(() => {
    setOpen(false)
  }, [projectId])
  const close = useCallback(() => setOpen(false), [])
  const openSkillsPage = useCallback(() => {
    setOpen(false)
    navigate('/skills')
  }, [navigate])
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <SkillLibraryOverlay projectId={projectId} onClose={close} onOpenSkillsPage={openSkillsPage} />
    </Suspense>
  )
}
