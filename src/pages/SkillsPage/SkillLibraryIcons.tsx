import {
  ChevronDown,
  Code,
  ExternalLink,
  Eye,
  FileText,
  Icon,
  Play,
  Star,
  X,
  type IconSize,
} from '../../ui/icon'

/**
 * 技能库图标的统一出口（第 4 批起几何来自 Lucide）。
 * 语义名保持不变，调用点不用改名；`filled` 仍用于收藏星与播放三角的实心态。
 */
interface IconProps {
  size?: IconSize
}

export function SkillStarIcon({ filled = false, size = 'md' }: IconProps & { filled?: boolean }) {
  return <Icon icon={Star} size={size} fill={filled ? 'currentColor' : 'none'} />
}

export function SkillCloseIcon({ size = 'md' }: IconProps) {
  return <Icon icon={X} size={size} />
}

export function SkillExternalIcon({ size = 'md' }: IconProps) {
  return <Icon icon={ExternalLink} size={size} />
}

export function SkillPlayIcon({ size = 'md' }: IconProps) {
  return <Icon icon={Play} size={size} fill="currentColor" />
}

export function SkillFileIcon({ size = 'md' }: IconProps) {
  return <Icon icon={FileText} size={size} />
}

export function SkillEyeIcon({ size = 'md' }: IconProps) {
  return <Icon icon={Eye} size={size} />
}

export function SkillCodeIcon({ size = 'md' }: IconProps) {
  return <Icon icon={Code} size={size} />
}

export function SkillChevronIcon({ size = 'md' }: IconProps) {
  return <Icon icon={ChevronDown} size={size} />
}
