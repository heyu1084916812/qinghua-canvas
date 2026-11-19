import styles from './FlowEdgeCutLayer.module.css'

/** 一次"切断"的两段折线（屏幕坐标 = surface 局部坐标） */
export interface ActiveEdgeCut {
  id: string
  top: string
  bottom: string
}

/**
 * 切断动画（对账 #1159，用户 2026-11-19 拍板 D：「上段下移、下段上移 + 渐隐」）。
 *
 * 为什么单独一层、而不是改 `QhEdge`：
 * 边组件是 RF 渲染的、跟着连线数据走 —— 线一删组件就卸载，动画没机会播。
 * 所以删除**推迟**到动画结束，动画期间由这一层用"屏幕坐标的两段折线"顶着，
 * 视觉上看还是原来那条线，只是被切开了。
 */
export function FlowEdgeCutLayer({ cut }: { cut: ActiveEdgeCut | null }) {
  if (!cut) return null
  return (
    <svg className={styles.layer} data-edge-cut={cut.id} aria-hidden>
      <path className={`${styles.edge} ${styles.top}`} d={cut.top} />
      <path className={`${styles.edge} ${styles.bottom}`} d={cut.bottom} />
    </svg>
  )
}
