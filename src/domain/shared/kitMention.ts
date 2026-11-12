/**
 * Agent 对话里 @ 套件（2026-11-12）：chip 的 id 同时冻结套件版本，
 * 形如 `kit_xxx@v3`。被选中的套件按「项目绑定」同一口径注入上下文，
 * 但只作用于本会话，不写项目绑定表。
 */

export interface SessionKitRef {
  kitId: string
  version: number
  name: string
}

const KIT_MENTION_ID = /^(.+)@v(\d+)$/

export function kitMentionId(kitId: string, version: number): string {
  return `${kitId}@v${Math.max(1, Math.floor(version))}`
}

export function parseKitMentionId(id: string): { kitId: string; version: number } | null {
  const match = KIT_MENTION_ID.exec(String(id ?? '').trim())
  if (!match) return null
  const version = Number(match[2])
  if (!match[1] || !Number.isInteger(version) || version < 1) return null
  return { kitId: match[1], version }
}

/**
 * 会话已选套件 + 本轮新 @ 的套件 → 去重后的会话套件列表。
 * 同一套件再次 @ 时以本轮的冻结版本为准（用户显式换了版本）。
 */
export function mergeSessionKits(
  existing: readonly SessionKitRef[] | undefined,
  mentioned: readonly { id: string; label: string }[],
): SessionKitRef[] {
  const byKit = new Map<string, SessionKitRef>()
  for (const ref of existing ?? []) {
    if (ref?.kitId && Number.isInteger(ref.version) && ref.version > 0) byKit.set(ref.kitId, ref)
  }
  for (const mention of mentioned) {
    const parsed = parseKitMentionId(mention.id)
    if (!parsed) continue
    byKit.delete(parsed.kitId)
    byKit.set(parsed.kitId, { ...parsed, name: mention.label.trim() || parsed.kitId })
  }
  return [...byKit.values()]
}

export function sameSessionKits(
  left: readonly SessionKitRef[] | undefined,
  right: readonly SessionKitRef[],
): boolean {
  const a = left ?? []
  return a.length === right.length &&
    a.every((ref, index) => ref.kitId === right[index]?.kitId && ref.version === right[index]?.version)
}

/** 落库行 → 会话套件列表；坏行丢弃，不猜版本。 */
export function normalizeSessionKits(value: unknown): SessionKitRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = item as Partial<SessionKitRef> | null
    if (!row || typeof row.kitId !== 'string' || !row.kitId) return []
    if (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1) return []
    return [{ kitId: row.kitId, version: row.version, name: typeof row.name === 'string' ? row.name : row.kitId }]
  })
}
