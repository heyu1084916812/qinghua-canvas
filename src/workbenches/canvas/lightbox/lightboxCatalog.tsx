/** 灯箱模式条、工具条与裁剪手柄的静态目录；不持有任何灯箱状态。 */
import type { CSSProperties } from 'react'
import type { CropHandle } from '../../../domain/canvas/fusion/fusionPlan'
import {
  IconAnnotate,
  IconCompare,
  IconCrop,
  IconImage,
  IconRect,
  IconRotate,
  IconScan,
  IconText,
} from '../toolbar/icons'

export const HANDLE_POS: Record<CropHandle, CSSProperties> = {
  nw: { left: 0, top: 0, cursor: 'nwse-resize' },
  n: { left: '50%', top: 0, cursor: 'ns-resize' },
  ne: { left: '100%', top: 0, cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: 0, top: '100%', cursor: 'nesw-resize' },
  w: { left: 0, top: '50%', cursor: 'ew-resize' },
}

export const EDITOR_MODES = [
  { id: 'view', label: '查看', icon: <IconImage size={16} /> },
  { id: 'extract', label: '提取选区', icon: <IconScan size={16} /> },
  { id: 'crop', label: '裁剪', icon: <IconCrop size={16} /> },
  { id: 'face', label: '框脸', icon: <IconScan size={16} /> },
  { id: 'annotate', label: '标注', icon: <IconAnnotate size={16} /> },
  { id: 'rotate', label: '旋转', icon: <IconRotate size={16} /> },
  { id: 'compare', label: '对比', icon: <IconCompare size={16} /> },
] as const

export const ANNOTATE_TOOLS = [
  { id: 'brush', label: '画笔', icon: <IconAnnotate size={16} /> },
  { id: 'rect', label: '矩形', icon: <IconRect size={16} /> },
  { id: 'text', label: '文字', icon: <IconText size={16} /> },
] as const
