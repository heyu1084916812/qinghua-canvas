import type { Channel } from '../../../domain/project/channel'
import type { ChannelActionState } from './channelActionCoordinator'

export interface TimerPorts {
  setTimeout(handler: () => void, delay: number): number
  clearTimeout(timer: number): void
}

export interface SelectedChannelPorts {
  resetPanel(): void
  resetChannelMenu(): void
  resetMapDrafts(): void
  resetMapSaveNotice(): void
  resetMapTests(): void
  clearMapSaveTimers(): void
  setActiveGroupId(groupId: string | null): void
  setForm(form: ChannelActionState['form']): void
}

/** 顺序是契约：先撤掉旧渠道的浮层、映射草稿与计时器，再初始化新渠道。 */
export function applySelectedChannelChange(
  channel: Channel | null,
  ports: SelectedChannelPorts,
): void {
  ports.resetPanel()
  ports.resetChannelMenu()
  ports.resetMapDrafts()
  ports.resetMapSaveNotice()
  ports.resetMapTests()
  ports.clearMapSaveTimers()
  if (!channel) return
  const groups = [...channel.credentialGroups].sort(
    (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
  )
  ports.setActiveGroupId(groups[0]?.id ?? null)
  ports.setForm({
    name: channel.name,
    protocol: channel.protocol,
    baseUrl: channel.baseUrl,
    enabled: channel.enabled,
  })
}

export interface KeyFacts {
  key: string
  shiftKey: boolean
  preventDefault(): void
}

export interface ChannelMenuLifecyclePorts extends TimerPorts {
  close(): void
  focusFirstButton(): void
  isInsideMenu(target: unknown): boolean
  onPointerDown(listener: (target: unknown) => void, capture: boolean): () => void
  onKeyDown(listener: (event: KeyFacts) => void): () => void
  onResize(listener: () => void): () => void
  onScroll(listener: () => void): () => void
}

export function watchChannelMenu(
  open: boolean,
  ports: ChannelMenuLifecyclePorts,
): () => void {
  if (!open) return () => {}
  const focusTimer = ports.setTimeout(ports.focusFirstButton, 0)
  const close = ports.close
  const removePointerDown = ports.onPointerDown((target) => {
    if (!ports.isInsideMenu(target)) close()
  }, true)
  const removeKeyDown = ports.onKeyDown((event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  })
  const removeResize = ports.onResize(close)
  const removeScroll = ports.onScroll(close)
  return () => {
    ports.clearTimeout(focusTimer)
    removePointerDown()
    removeKeyDown()
    removeResize()
    removeScroll()
  }
}

export interface ProfileDrawerLifecyclePorts extends TimerPorts {
  syncBounds(): void
  focusNameInput(): void
  close(): void
  trapTabFocus(event: KeyFacts): void
  restoreFocus(): void
  onKeyDown(listener: (event: KeyFacts) => void): () => void
  onResize(listener: () => void): () => void
}

export function watchProfileDrawer(
  open: boolean,
  ports: ProfileDrawerLifecyclePorts,
): () => void {
  if (!open) return () => {}
  ports.syncBounds()
  const focusTimer = ports.setTimeout(ports.focusNameInput, 0)
  const removeKeyDown = ports.onKeyDown((event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      ports.close()
      return
    }
    ports.trapTabFocus(event)
  })
  const removeResize = ports.onResize(ports.syncBounds)
  return () => {
    ports.clearTimeout(focusTimer)
    removeKeyDown()
    removeResize()
    ports.restoreFocus()
  }
}

export function clearTimedNotice(
  present: boolean,
  delay: number,
  clear: () => void,
  ports: TimerPorts,
): () => void {
  if (!present) return () => {}
  const timer = ports.setTimeout(clear, delay)
  return () => ports.clearTimeout(timer)
}

export function clearMapSaveTimers(
  timers: Map<string, number>,
  clearTimeout: (timer: number) => void,
): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}
