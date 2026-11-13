import {
  ArrowLeftRight,
  Crop,
  Expand,
  FileSearch,
  Icon,
  Image,
  Images,
  LayoutGrid,
  ListChecks,
  Move,
  Play,
  ScanEye,
  Search,
  SlidersHorizontal,
  Trash2,
  Unlink,
  WandSparkles,
  Workflow,
  type IconSize,
} from '../../../../ui/icon'

/**
 * Agent 过程步骤标题前的小图标（第 5 批起几何全部来自 Lucide）。
 *
 * `data-agent-step-icon` 锚点保留：它是冒烟 / 测试识别「这一步是什么工具」的接口，
 * 与图标库无关。
 */
export function AgentStepIcon({ tool, size = 'sm' }: { tool: string; size?: IconSize }) {
  const glyph = (() => {
    switch (tool) {
      case 'readGraph':
        return FileSearch
      case 'readAsset':
        return Image
      case 'readResult':
        return Images
      case 'researchDesign':
      case 'readPage':
      case 'curateReferences':
        return Search
      case 'visualReview':
        return ScanEye
      case 'proposeTaskPlan':
      case 'updateTaskStep':
      case 'requestTaskConfirmation':
        return ListChecks
      case 'applyPlan':
        return Workflow
      case 'updateNode':
        return SlidersHorizontal
      case 'runNode':
        return WandSparkles
      case 'runFrom':
        return Play
      case 'moveNodes':
        return Move
      case 'arrangeNodes':
      case 'splitGrid':
        return LayoutGrid
      case 'resizeNodes':
        return Expand
      case 'deleteNodes':
        return Trash2
      case 'deleteEdges':
        return Unlink
      case 'compareNodes':
        return ArrowLeftRight
      case 'sliceImage':
        return Crop
      default:
        return ListChecks
    }
  })()
  return <Icon icon={glyph} size={size} data-agent-step-icon={tool} />
}
