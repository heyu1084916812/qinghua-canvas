export function channelMenuArrowFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const items = [
    ...(event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ) ?? []),
  ]
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const delta = event.key === 'ArrowDown' ? 1 : -1
  items[(current + delta + items.length) % items.length]?.focus()
}

export function drawerTabFocus(event: KeyboardEvent, drawer: HTMLElement | null) {
  if (event.key !== 'Tab' || !drawer) return
  const focusable = Array.from(
    drawer.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
