/**
 * C1：参考卡的语义标题。参考分析给出按主体 / 用途起的短名（「拿铁杯产品图」），
 * 替换掉文件名式的自动标题（`_Image 17.jpg`）；用户自己起过的标题保持不变。纯函数。
 */

const TITLE_LIMIT = 16
const FILE_EXTENSION = /\.(?:jpe?g|png|webp|gif|bmp|heic|avif|tiff?|svg)$/i
const AUTO_TITLE =
  /^[_\s-]*(?:image|img|pic|photo|picture|screenshot|dsc|dcim|untitled|截图|屏幕截图|微信图片|图片|未命名|参考图?)[\s_-]*[\d_\s()（）-]*$/i

/**
 * 参考卡标题是不是「自动标题」：空、文件名（带扩展名）、或 Image 17 / 截图_2026… 这类无语义名。
 * 只有自动标题才会被分析结果的语义短名替换；用户自己改过的标题保持不变。
 */
export function isAutoReferenceTitle(title: string): boolean {
  const value = title.trim()
  if (!value) return true
  if (FILE_EXTENSION.test(value)) return true
  return AUTO_TITLE.test(value)
}

/** 模型给的短名：裁空白、去引号与扩展名，过长截断；仍像文件名 / 自动名则丢弃。 */
export function curatedTitleOf(value: unknown): string {
  const raw = (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '')
    .replace(/^[「『"'“”‘’《]+|[」』"'“”‘’》]+$/g, '')
    .trim()
  if (!raw || isAutoReferenceTitle(raw)) return ''
  return raw.slice(0, TITLE_LIMIT)
}
