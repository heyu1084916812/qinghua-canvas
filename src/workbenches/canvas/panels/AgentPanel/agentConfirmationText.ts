/**
 * 确认卡正文 → 可读的短行。
 *
 * 模型有时把“确认 5 件事”塞进一个段落；直接塞进一条 `<li>` 会变成整屏灰墙。
 * 这里只做确定性的排版拆分：保留原文，在编号项和长句的分号 / 句号处换行。
 */
export function readableConfirmationLines(text: string): string[] {
  const source = text.replace(/\r\n?/g, '\n').trim()
  if (!source) return []
  const withListBreaks = source
    .replace(/\s+(?=(?:\d{1,2}[.)、]|[①②③④⑤⑥⑦⑧⑨⑩]))/g, '\n')
    .replace(/([；;])\s*(?=(?:\d{1,2}[.)、]|[①②③④⑤⑥⑦⑧⑨⑩]))/g, '$1\n')
    .replace(/([：:])\s*(?=(?:\d{1,2}[.)、]|[①②③④⑤⑥⑦⑧⑨⑩]))/g, '$1\n')
  return withListBreaks
    .split(/\n+/)
    .flatMap((part) => {
      const line = part.trim()
      if (!line) return []
      if (line.length <= 96) return [line]
      return line
        .replace(/([。；;])(?=\S)/g, '$1\n')
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
    })
    .slice(0, 24)
}
