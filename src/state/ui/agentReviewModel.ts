let current = ''
const listeners = new Set<() => void>()

export function getAgentReviewModel(): string {
  return current
}

export function setAgentReviewModel(value: unknown): void {
  const next = typeof value === 'string' ? value.trim() : ''
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribeAgentReviewModel(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function __resetAgentReviewModelForTest(): void {
  current = ''
  for (const listener of listeners) listener()
}
