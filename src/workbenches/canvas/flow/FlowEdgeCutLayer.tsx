import styles from './FlowEdgeCutLayer.module.css'

/** 一次"切断"的两段折线（屏幕坐标 = surface 局部坐标）；`key` 用于同一帧切多条时区分 */
export interface ActiveEdgeCut {
  id: string
  top: string
  bottom: string
  key: string
}

/**
 * 切断动画（对账 #1159，用户 2026-11-19 拍板 D：「上段下移、下段上移 + 渐隐」）。
 *
 * 为什么单独一层、而不是改 `QhEdge`：
 * 边组件是 RF 渲染的、跟着连线数据走 —— 线一删组件就卸载，动画没机会播。
 * 所以这里用**屏幕坐标的两段折线**自己画：删边可以立刻发生（Undo 才能当场合并），
 * 残影照样播完。支持一次挥刀切中多条（数组 + 各自的 key）。
 */
export function FlowEdgeCutLayer({ cuts }: { cuts: readonly ActiveEdgeCut[] }) {
  if (cuts.length === 0) return null
  return (
    <svg className={styles.layer} data-edge-cut={cuts.length} aria-hidden>
      {cuts.map((cut) => (
        <g key={cut.key} data-edge-cut-id={cut.id}>
          <path className={`${styles.edge} ${styles.top}`} d={cut.top} />
          <path className={`${styles.edge} ${styles.bottom}`} d={cut.bottom} />
        </g>
      ))}
    </svg>
  )
}