/**
 * 项目树的线性图标（侧栏「我的项目」那一棵树）。
 *
 * 第 3 批起几何全部来自 Lucide（`src/ui/icon`），本文件只做「语义名 → 图标」映射；
 * 语义名保持不变，调用点不用改名。
 */
import {
  ChevronRight,
  Copy,
  Ellipsis,
  Folder,
  FolderInput,
  FolderOpen,
  FolderOutput,
  Icon,
  Pencil,
  Pin,
  Plus,
  SquareX,
  Trash2,
  Upload,
  type IconSize,
} from '../ui/icon'

interface IconProps {
  size?: IconSize
}

export function IconChevron({ size = 'sm' }: IconProps) {
  return <Icon icon={ChevronRight} size={size} />
}

export function IconFolder({ size = 'md' }: IconProps) {
  return <Icon icon={Folder} size={size} />
}

export function IconPin({ size = 'sm' }: IconProps) {
  return <Icon icon={Pin} size={size} />
}

export function IconMore({ size = 'md' }: IconProps) {
  return <Icon icon={Ellipsis} size={size} />
}

export function IconPlus({ size = 'md' }: IconProps) {
  return <Icon icon={Plus} size={size} />
}

export function IconRename({ size = 'md' }: IconProps) {
  return <Icon icon={Pencil} size={size} />
}

export function IconMove({ size = 'md' }: IconProps) {
  return <Icon icon={FolderInput} size={size} />
}

export function IconCopy({ size = 'md' }: IconProps) {
  return <Icon icon={Copy} size={size} />
}

export function IconReveal({ size = 'md' }: IconProps) {
  return <Icon icon={FolderOpen} size={size} />
}

export function IconUpload({ size = 'md' }: IconProps) {
  return <Icon icon={Upload} size={size} />
}

export function IconCloseCanvas({ size = 'md' }: IconProps) {
  return <Icon icon={SquareX} size={size} />
}

export function IconTrash({ size = 'md' }: IconProps) {
  return <Icon icon={Trash2} size={size} />
}

export function IconFolderOut({ size = 'md' }: IconProps) {
  return <Icon icon={FolderOutput} size={size} />
}
