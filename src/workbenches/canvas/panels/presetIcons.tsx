import {
  Box,
  Camera,
  Clapperboard,
  Grid3x3,
  History,
  Image,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  Maximize2,
  NotebookText,
  Palette,
  Play,
  ScanEye,
  Smile,
  type IconGlyph,
} from '../../../ui/icon'

/**
 * 预设菜单每条预设用的图标（用户 2026-11-18：「这些图案视觉看起来大小不对，有没有改成我项目
 * 用得统一素材图标库」）。
 *
 * 原来这里是**逐条手绘的 SVG**，每条线宽/内缩各写一遍，渲染出来大小参差（同一列里看着忽大忽小）。
 * 现在统一走 `ui/icon`（Lucide 一套、`size="md"` 16px、线宽由 `Icon` 按尺寸换算），
 * 于是同一菜单里的图标视觉重量一致，也和项目其它面板同源。
 */
export const PRESET_ICON: Record<string, IconGlyph> = {
  'shot-list': Clapperboard,
  storyboard: LayoutGrid,
  'storyboard-25': Grid3x3,
  'beats-4': LayoutDashboard,
  'later-3s': Play,
  'earlier-5s': History,
  'panorama-720': Maximize2,
  'multicam-9': Camera,
  'face-turnaround': ScanEye,
  'body-turnaround': Image,
  'character-sheet': NotebookText,
  'scene-sheet': Layers,
  'product-sheet': Box,
  'portrait-texture': Palette,
  'cinematic-light': Lightbulb,
  emotion: Smile,
}
