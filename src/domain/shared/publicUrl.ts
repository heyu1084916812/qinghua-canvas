function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false
  const octets = host.split('.').map(Number)
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true
  }
  const [a = 0, b = 0, c = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224 ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function ipv4FromMappedIpv6(host: string): string {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (!match) return ''
  const high = Number.parseInt(match[1]!, 16)
  const low = Number.parseInt(match[2]!, 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

export function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.home.arpa')
    ) {
      return false
    }
    if (isPrivateIpv4(host)) return false
    const mapped = ipv4FromMappedIpv6(host)
    if (mapped && isPrivateIpv4(mapped)) return false
    if (
      host === '::1' ||
      host === '::' ||
      (host.includes(':') &&
        (host.startsWith('fc') ||
          host.startsWith('fd') ||
          host.startsWith('fe80:') ||
          host.startsWith('2001:db8:')))
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}
