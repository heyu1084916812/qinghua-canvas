import type { LucideIcon } from 'lucide-react'
import { gridStrokeWidth, ICON_GRID, ICON_SIZE_PX, type IconSize } from './iconTokens'

/**
 * 图标的 SVG 字符串形态（轻画-图标统一方案 §4.3）。
 *
 * 命令式 DOM（如 MentionEditor 的 chip）拿不到 React 组件，只能塞字符串。
 * 几何取自同一个 Lucide 组件内部的 icon 数据，线宽走同一个 `gridStrokeWidth`，
 * 因此与 `<Icon>` 渲染出来的形状、粗细一致，不会再出现「两份手抄 path」。
 */
type IconAttrs = Record<string, string | number | undefined>
type IconNodeEntry = [string, IconAttrs, IconNodeEntry[]?]
interface IconData {
  node: IconNodeEntry[]
  size?: number
}

/**
 * lucide-react 的每个图标是 `forwardRef(props => createElement(Icon, { icon: data }))`。
 * 调一次 render 拿到元素，读出 `props.icon` 即几何数据；不经过 React 渲染器。
 * 自绘图标（custom/）走 `createLucideIcon`，形状相同，同样适用。
 */
export function iconDataOf(glyph: LucideIcon): IconData {
  const render = (glyph as unknown as { render?: (props: object, ref: null) => unknown }).render
  const element = render?.({}, null) as { props?: { icon?: IconData } } | undefined
  const data = element?.props?.icon
  if (!data || !Array.isArray(data.node)) throw new Error('iconDataOf: 不是 Lucide 图标组件')
  return data
}

const SKIP_ATTRS = new Set(['key'])
const escapeAttr = (value: string | number) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function attrsToString(attrs: IconAttrs): string {
  return Object.entries(attrs)
    .filter(([name, value]) => !SKIP_ATTRS.has(name) && value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttr(value as string | number)}"`)
    .join('')
}

function nodeToString([tag, attrs, children]: IconNodeEntry): string {
  const inner = children?.map(nodeToString).join('') ?? ''
  // 与 React 的 renderToStaticMarkup 同口径：一律写闭合标签，便于逐字比对。
  return `<${tag}${attrsToString(attrs)}>${inner}</${tag}>`
}

export function iconSvgString(glyph: LucideIcon, size: IconSize = 'sm'): string {
  const data = iconDataOf(glyph)
  const px = ICON_SIZE_PX[size]
  const grid = data.size ?? ICON_GRID
  const head = attrsToString({
    xmlns: 'http://www.w3.org/2000/svg',
    width: px,
    height: px,
    viewBox: `0 0 ${grid} ${grid}`,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': gridStrokeWidth(px),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    'data-icon-size': size,
  })
  return `<svg${head}>${data.node.map(nodeToString).join('')}</svg>`
}
