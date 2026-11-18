import type { MutableRefObject } from 'react'
import { TAB_HEADER_HEIGHT, inactiveTabPath } from './folderTabGeometry'
import { settingsPageStyles as styles } from './settingsPageStyles'

/**
 * Key 分组标签的几何层（不是图标，故保留手写 `<svg>`）：
 * 每枚标签一张静止梯形，选中态另有一块共享形变层，路径随真实像素宽高生成。
 */
export function FolderTabShape({
  width,
  height,
  first,
}: {
  width: number
  height: number
  first: boolean
}) {
  return (
    <svg
      className={styles.keyGroupTabShape}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path className={styles.keyGroupTabShapePath} d={inactiveTabPath(width, height, first)} />
    </svg>
  )
}

/** 选中标签的形变层：位置 / 宽度 / 高度由父组件的弹簧逐帧写进 path。 */
export function FolderTabMorphLayer({
  svgRef,
  pathRef,
}: {
  svgRef: MutableRefObject<SVGSVGElement | null>
  pathRef: MutableRefObject<SVGPathElement | null>
}) {
  return (
    <svg
      ref={svgRef}
      className={styles.keyGroupMorph}
      width={0}
      height={TAB_HEADER_HEIGHT}
      aria-hidden
    >
      <path ref={pathRef} className={styles.keyGroupMorphPath} />
    </svg>
  )
}
