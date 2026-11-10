const KNOWN_PLACEHOLDER_HOST = 'cdn.dancf.com'
const KNOWN_PLACEHOLDER_PATH = '/fe-assets/'

export function isKnownClipperPlaceholderImageUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.hostname.toLowerCase() === KNOWN_PLACEHOLDER_HOST
      && url.pathname.toLowerCase().startsWith(KNOWN_PLACEHOLDER_PATH)
  } catch {
    return false
  }
}
