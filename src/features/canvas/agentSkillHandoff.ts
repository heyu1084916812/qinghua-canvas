const pendingByProject = new Map<string, string>()
const listenersByProject = new Map<
  string,
  Set<(skillId: string) => void>
>()

export function sendSkillToAgent(
  projectId: string,
  skillId: string,
): void {
  if (!projectId) return
  const id = skillId.trim()
  if (!id) return
  pendingByProject.set(projectId, id)
  for (const listener of listenersByProject.get(projectId) ?? []) {
    listener(id)
  }
}

export function takeAgentSkillHandoff(projectId: string): string | null {
  const id = pendingByProject.get(projectId) ?? null
  pendingByProject.delete(projectId)
  return id
}

export function subscribeAgentSkillHandoff(
  projectId: string,
  listener: (skillId: string) => void,
): () => void {
  let listeners = listenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    listenersByProject.set(projectId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByProject.delete(projectId)
  }
}
