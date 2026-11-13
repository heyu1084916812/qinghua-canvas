/**
 * 图标规范的 JS 侧常量（轻画-图标统一方案 §3）。
 *
 * 与 `ui/tokens.css` 的 `--icon-*` 同值；改线宽只改 `ICON_STROKE` 与 CSS 变量两处，
 * `iconTokens.test.ts` 会读 CSS 文件比对，防止两边漂移。
 */
export type IconSize = 'sm' | 'md' | 'lg'

/** sm 用于输入框内 / 标签 / chip；md 为默认；lg 用于空状态与标题区。 */
export const ICON_SIZE_PX: Readonly<Record<IconSize, number>> = {
  sm: 14,
  md: 16,
  lg: 20,
}

/** 屏幕像素线宽：配合 `absoluteStrokeWidth`，三档尺寸视觉粗细一致。 */
export const ICON_STROKE = 1.5

/** 图标与相邻文字的间距（px）。 */
export const ICON_GAP_PX: Readonly<Record<IconSize, number>> = {
  sm: 6,
  md: 8,
  lg: 8,
}

/** Lucide 图标的设计网格边长。 */
export const ICON_GRID = 24

/**
 * `absoluteStrokeWidth` 的换算：在 `size` 像素下要画出 `ICON_STROKE` 像素粗的线，
 * 24 网格坐标里的 stroke-width 应为多少。与 lucide-react 内部同一公式，
 * 字符串形态（svgString.ts）与 React 形态共用，保证两者逐字一致。
 */
export function gridStrokeWidth(sizePx: number, stroke: number = ICON_STROKE): number {
  return Number(((stroke * ICON_GRID) / sizePx).toFixed(4))
}
