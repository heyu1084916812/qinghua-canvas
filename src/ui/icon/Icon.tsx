import type { LucideIcon, LucideProps } from 'lucide-react'
import { gridStrokeWidth, ICON_SIZE_PX, type IconSize } from './iconTokens'

/**
 * 全站唯一的图标出口（轻画-图标统一方案 §2）。
 *
 * - 尺寸只有三档（sm 14 / md 16 / lg 20），业务代码不写像素数。
 * - 线宽固定为屏幕像素 1.5：按尺寸换算成 24 网格里的 stroke-width，等价于
 *   Lucide 的 `absoluteStrokeWidth`（该参数在 lucide-react 1.x 已标废弃，故自己算，
 *   与字符串形态共用 `gridStrokeWidth`）。
 * - 颜色跟随 `currentColor`，明暗主题自动适配。
 * - 默认纯装饰 `aria-hidden`；传了 `label` 则作为有名字的图形（`role="img"`）。
 *   独立图标按钮的名字应写在按钮的 `aria-label` 上，图标本身保持装饰。
 */
export interface IconProps
  extends Omit<LucideProps, 'size' | 'strokeWidth' | 'absoluteStrokeWidth' | 'ref' | 'color'> {
  /** 来自 `ui/icon` 的图标组件（Lucide 或 `custom/` 自绘）。 */
  icon: LucideIcon
  size?: IconSize
  /** 有意义的独立图形才传；按钮内的图标不要传，名字写在按钮上。 */
  label?: string
}

export function Icon({ icon: Glyph, size = 'md', label, ...rest }: IconProps) {
  const px = ICON_SIZE_PX[size]
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true as const, focusable: 'false' as const }
  return (
    <Glyph
      {...rest}
      {...a11y}
      data-icon-size={size}
      size={px}
      strokeWidth={gridStrokeWidth(px)}
      color="currentColor"
    />
  )
}
