import { useEffect, useRef } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { parseMentions } from '../../text/MentionEditor'

/**
 * 「草稿里把**已选技能**的 chip 删掉」→ 自动清掉技能设置。
 *
 * 为什么需要 `seen` 守卫：面板打开时草稿里可能本来就没有那颗 chip（技能是上次
 * 选的），那种"没看见过"不算用户删除，不能把设置清掉。只有**同一条会话、同一个
 * 技能、且上一拍确实看见过**、这一拍没了、并且用户还在写东西（draft 非空）时，
 * 才算"用户主动删了 chip"。
 *
 * 清设置失败只经 `runPromiseDetached` 提示一次，不阻断输入。
 */
export interface AgentSkillChipResetInput {
  current: AgentSession | null
  draft: string
  setSkill: (skillId: string) => Promise<unknown>
  runPromiseDetached: (
    work: Promise<unknown>,
    failureMessage: string,
  ) => void
}

interface SeenSkillChip {
  sessionId: string
  skillId: string
  seen: boolean
}

export function useAgentSkillChipReset(
  input: AgentSkillChipResetInput,
): void {
  const seenRef = useRef<SeenSkillChip | null>(null)

  useEffect(() => {
    const current = input.current
    if (!current?.skillId) {
      seenRef.current = null
      return
    }
    const skillId = current.skillId
    const seen = parseMentions(input.draft)
      .filter((mention) => mention.kind === 'skill')
      .some((mention) => mention.id === skillId)
    const prev = seenRef.current
    const removed =
      input.draft.trim() !== '' &&
      prev?.sessionId === current.id &&
      prev.skillId === skillId &&
      prev.seen &&
      !seen
    if (removed) {
      input.runPromiseDetached(
        input.setSkill(''),
        '清除技能设置失败',
      )
    }
    seenRef.current = { sessionId: current.id, skillId, seen }
  }, [
    input.draft,
    input.current?.id,
    input.current?.skillId,
    input.runPromiseDetached,
    input.setSkill,
  ])
}
