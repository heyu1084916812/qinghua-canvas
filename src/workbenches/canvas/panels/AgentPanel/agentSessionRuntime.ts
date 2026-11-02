export interface StickyAgentMediaModels {
  image?: string
  video?: string
}

/**
 * AgentPanel 内不参与渲染、但必须跟随会话保存的瞬时状态。
 *
 * 面板关闭时宿主不会卸载 AgentPanel；仍然把所有状态显式按 sessionId 分桶，
 * 避免两个并行会话通过一个 ref 互相覆盖。
 */
export class AgentSessionRuntimeState {
  private readonly perImage = new Map<string, boolean>()
  private readonly stickyModels = new Map<string, StickyAgentMediaModels>()

  setPerImage(sessionId: string, value: boolean): void {
    if (!sessionId) return
    if (value) this.perImage.set(sessionId, true)
    else this.perImage.delete(sessionId)
  }

  isPerImage(sessionId: string): boolean {
    return Boolean(sessionId && this.perImage.get(sessionId))
  }

  rememberStickyModel(
    sessionId: string,
    kind: 'image' | 'video',
    model: string,
  ): void {
    if (!sessionId || !model.trim()) return
    this.stickyModels.set(sessionId, {
      ...this.stickyModels.get(sessionId),
      [kind]: model,
    })
  }

  stickyModelsFor(sessionId: string): StickyAgentMediaModels {
    if (!sessionId) return {}
    return this.stickyModels.get(sessionId) ?? {}
  }

  clearSession(sessionId: string): void {
    this.perImage.delete(sessionId)
    this.stickyModels.delete(sessionId)
  }
}
