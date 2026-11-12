/** 问题卡（Lovart 样式）的纯视图计算：字母序与「当前在看第几题」。 */

/** 选项行的字母：A、B、C…（最多 6 个选项 + 1 行自由输入，不会超过 G）。 */
export function questionOptionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * 滚动区里「当前在看第几题」：最后一个顶边已进入可视区上部（threshold，默认 24px；面板传可视高度的 1/3）的题；
 * 已滚到底时算最后一题（最后一题较短、顶边永远到不了顶部时，页码也要能走到 N）。
 */
export function questionIndexInView(
  offsets: readonly number[],
  scrollTop: number,
  atBottom: boolean,
  threshold = 24,
): number {
  if (offsets.length === 0) return 0
  if (atBottom) return offsets.length - 1
  let current = 0
  offsets.forEach((top, index) => {
    if (top - scrollTop <= threshold) current = index
  })
  return current
}
