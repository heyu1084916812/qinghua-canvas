const DEFAULT_AGENT_CANVAS_REVIEW = false

let current = DEFAULT_AGENT_CANVAS_REVIEW
const listeners = new Set<() => void>()

export function getAgentCanvasReview(): boolean {
  return current
}

export function setAgentCanvasReview(value: unknown): void {
  const next = typeof value === 'boolean' ? value : DEFAULT_AGENT_CANVAS_REVIEW
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribeAgentCanvasReview(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function __resetAgentCanvasReviewForTest(): void {
  current = DEFAULT_AGENT_CANVAS_REVIEW
  for (const listener of listeners) listener()
}
