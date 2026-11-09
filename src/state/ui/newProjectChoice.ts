let open = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function requestNewProjectChoice(): void {
  if (open) return
  open = true
  notify()
}

export function closeNewProjectChoice(): void {
  if (!open) return
  open = false
  notify()
}

export function getNewProjectChoiceOpen(): boolean {
  return open
}

export function subscribeNewProjectChoice(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
