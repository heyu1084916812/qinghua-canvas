const CUSTOM_PROTOCOL_ID_MAX = 32

function stableNameHash(value: string): number {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function protocolNameStem(name: string): string {
  const normalized = name
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 24)
  if (normalized.length >= 2) return normalized
  return `custom-${stableNameHash(name || 'protocol').toString(36)}`
}

export function customProtocolShortForName(name: string): string {
  return Array.from(name.trim().replace(/\s+/g, '')).slice(0, 8).join('') || '自定义'
}

export function customProtocolIdForName(
  name: string,
  existing: Iterable<string>,
): string {
  const taken = new Set(existing)
  const stem = protocolNameStem(name)
  let candidate = stem
  let suffix = 2
  while (taken.has(candidate)) {
    const tail = `-${suffix}`
    candidate = `${stem.slice(0, CUSTOM_PROTOCOL_ID_MAX - tail.length)}${tail}`
    suffix += 1
  }
  return candidate
}

export function protocolVersionForBaseUrl(baseUrl: string): string {
  try {
    const path = new URL(baseUrl.trim()).pathname.replace(/\/+$/, '')
    const match = /\/(api\/v\d+|v\d+)$/i.exec(path)
    return match ? `/${match[1]}` : '/v1'
  } catch {
    return '/v1'
  }
}
