/**
 * The collapsed row is a headline, not a transcript. Keep the newest complete
 * sentence (or newest line) and leave the full accumulated text in the fold.
 */
export function latestProcessLine(text: string): string {
  const rows = text
    .split(/\r?\n|(?<=[。！？!?])\s*/u)
    .map((row) => row.trim())
    .filter(Boolean)
  return rows.at(-1) ?? ''
}

export function isAdvanceTaskCommand(text: string): boolean {
  const normalized = text.replace(/[\s，。！？!?、]/g, '').toLowerCase()
  return new Set([
    '直接下一步',
    '下一步',
    '直接进入下一步',
    '跳过验收',
    '跳过验收直接下一步',
  ]).has(normalized)
}
