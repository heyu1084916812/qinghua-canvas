import { Slice } from '../../../ui/icon'
import styles from './FlowEdgeCutLayer.module.css'

/**
 * 跟着指针走的美工刀（对账 #1159）。
 *
 * 为什么不用 CSS `cursor: url(...)`：那要位图 + 固定热点 + 深浅主题两张；而这里要的正是
 * "项目自己的图标"，直接渲染公共图标库（lucide `Slice`）最省事、也跟着字色走。
 * 原生指针由画布根的 `.knifeMode` 整层隐藏（见 `FlowSurface.module.css`）。
 */
export function KnifeCursor({ x, y }: { x: number; y: number }) {
  return (
    <div className={styles.knifeCursor} data-knife-cursor style={{ left: x, top: y }} aria-hidden>
      <Slice size={18} />
    </div>
  )
}