import { forwardRef, useImperativeHandle, useEffect, useRef, useState } from 'react'
import styles from './FlowEdgeCutLayer.module.css'

/** 一次"切断"的两段折线（屏幕坐标 = surface 局部坐标）；`key` 用于同一帧切多条时区分 */
export interface ActiveEdgeCut {
  id: string
  top: string
  bottom: string
  key: string
}

/** 独立播放命中预览，不让逐帧残影更新触发整个画布重渲染。 */
export interface CutPreview { show: (batch: ActiveEdgeCut[]) => void }
export const FlowEdgeCutLayer = forwardRef<CutPreview>(function FlowEdgeCutLayer(_, ref) {
  const [cuts,setCuts] = useState<ActiveEdgeCut[]>([])
  const timers = useRef(new Set<number>())
  useEffect(() => { const active=timers.current; return () => { for (const id of active) clearTimeout(id) } }, [])
  useImperativeHandle(ref, () => ({ show(batch) {
    setCuts(prev => [...prev,...batch])
    const keys=new Set(batch.map(c=>c.key))
    const timer=window.setTimeout(()=>{timers.current.delete(timer);setCuts(prev=>prev.filter(c=>!keys.has(c.key)))},320)
    timers.current.add(timer)
  } }), [])
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
})
