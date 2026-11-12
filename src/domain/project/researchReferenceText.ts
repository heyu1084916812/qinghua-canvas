/**
 * 台账 `what` → 提示词里的一段：取出调研图的原图地址（「图片地址：…」行），去掉与 provenance
 * 重复的来源页行和旧数据里的占位文字「图源：查看图片搜索结果」，多行压成一行，免得拆散 bullet。
 */
export function referenceWhatForPrompt(raw: string): { imageUrl: string; what: string } {
  let imageUrl = ''
  const parts = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    if (!line || line === '图源：查看图片搜索结果') return false
    const image = /^图片地址：\s*(https?:\/\/\S+)$/.exec(line)
    if (image) {
      imageUrl ||= image[1]!
      return false
    }
    return !line.startsWith('来源页面：')
  })
  return { imageUrl, what: parts.join('；') }
}
