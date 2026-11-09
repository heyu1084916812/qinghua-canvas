const EVENT = 'qinghua:context-kits-dialog'

export function openContextKitsDialog(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function subscribeContextKitsDialog(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
