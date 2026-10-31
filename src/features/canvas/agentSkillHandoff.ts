let pending: string | null = null
const listeners = new Set<(skillId: string) => void>()

export function sendSkillToAgent(skillId: string): void {
  const id = skillId.trim()
  if (!id) return
  pending = id
  for (const listener of listeners) listener(id)
}

export function takeAgentSkillHandoff(): string | null {
  const id = pending
  pending = null
  return id
}

export function subscribeAgentSkillHandoff(
  listener: (skillId: string) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
