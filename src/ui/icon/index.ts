/**
 * 图标唯一入口（轻画-图标统一方案 §4.1）。
 *
 * 业务代码只从这里取图标，不直接 `import 'lucide-react'`（eslint 拦截）。
 * 这样以后整体换库、调线宽只动 `ui/icon/` 一处。
 * 新增图标：在下方按字母序加一行 re-export，名字沿用 Lucide 原名。
 */
export { Icon, type IconProps } from './Icon'
export { iconSvgString } from './svgString'
export {
  ICON_GAP_PX,
  ICON_SIZE_PX,
  ICON_STROKE,
  type IconSize,
} from './iconTokens'
export type { LucideIcon as IconGlyph } from 'lucide-react'

export {
  ArrowUp,
  Network,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  Folder,
  House,
  Image,
  LayoutDashboard,
  Minus,
  PanelLeft,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
