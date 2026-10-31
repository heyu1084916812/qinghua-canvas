export function imageMimeFromBytes(bytes: Uint8Array): string {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (
    starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) ||
    starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
  ) {
    return 'image/gif'
  }
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml'
  }
  return ''
}
