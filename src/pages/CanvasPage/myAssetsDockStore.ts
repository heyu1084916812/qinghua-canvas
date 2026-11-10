export interface MyAssetsDockStore {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
  setOpen(open: boolean): void
  toggle(): void
}

export function createMyAssetsDockStore(): MyAssetsDockStore {
  let open = false
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => open,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setOpen(next) {
      if (open === next) return
      open = next
      publish()
    },
    toggle() {
      open = !open
      publish()
    },
  }
}
