/**
 * 全局设置左导航的线性图标（用户 2026-10-10 #8：
 * 「全局设置里面具体的功能需要在前面加图标，参考图五，要风格一样，配套的矢量图标」）。
 *
 * 与 `AppSidebarIcons`（一级导航那套）**同一套语言**：尺寸三档、`currentColor`、
 * 不填充、24 视窗、屏幕线宽 1.5。两套分开住是有意的 ——
 * 一级导航是"去哪儿"，设置是"调什么"，同形不同义。
 *
 * 第 2 批起几何全部来自 Lucide（`src/ui/icon`），本文件只做「语义名 → 图标」映射。
 */
import {
  Bell,
  Cable,
  Camera,
  CircleHelp,
  CloudUpload,
  Database,
  Download,
  Droplet,
  EllipsisVertical,
  Funnel,
  GripVertical,
  History,
  Icon,
  ImageUp,
  Info,
  Keyboard,
  List,
  NotebookText,
  Package,
  Palette,
  Pencil,
  Plug,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  Type,
  X,
  type IconSize,
} from '../ui/icon'

interface IconProps {
  size?: IconSize
}

/** 渠道配置：电源插头（"连到哪个站"） */
export function IconChannels({ size = 'md' }: IconProps) {
  return <Icon icon={Plug} size={size} />
}

/** CLI：终端提示符 */
export function IconCli({ size = 'md' }: IconProps) {
  return <Icon icon={SquareTerminal} size={size} />
}

/** 素材传输：云上传 */
export function IconHosting({ size = 'md' }: IconProps) {
  return <Icon icon={CloudUpload} size={size} />
}

/** Canvas MCP：本机画布与外部 harness 之间的双向链路。 */
export function IconMcpLink({ size = 'md' }: IconProps) {
  return <Icon icon={Cable} size={size} />
}

/** 存储：数据库 */
export function IconStorage({ size = 'md' }: IconProps) {
  return <Icon icon={Database} size={size} />
}

/** 总日志：记录列表。 */
export function IconLogs({ size = 'md' }: IconProps) {
  return <Icon icon={List} size={size} />
}

/** 外观与体验：调色板 */
export function IconAppearance({ size = 'md' }: IconProps) {
  return <Icon icon={Palette} size={size} />
}

/** 备份与恢复：回到某个时间点（时钟 + 回转箭头） */
export function IconBackup({ size = 'md' }: IconProps) {
  return <Icon icon={History} size={size} />
}

/** 默认参数：滑杆 */
export function IconDefaults({ size = 'md' }: IconProps) {
  return <Icon icon={SlidersHorizontal} size={size} />
}

/** Agent 与记忆：记忆卡 */
export function IconMemory({ size = 'md' }: IconProps) {
  return <Icon icon={NotebookText} size={size} />
}

/** 扩展包：包裹盒 */
export function IconPacks({ size = 'md' }: IconProps) {
  return <Icon icon={Package} size={size} />
}

/** 通知：铃铛 */
export function IconNotify({ size = 'md' }: IconProps) {
  return <Icon icon={Bell} size={size} />
}

/** 帮助：疑问圈 */
export function IconHelp({ size = 'md' }: IconProps) {
  return <Icon icon={CircleHelp} size={size} />
}

/** 快捷键：键盘。 */
export function IconKeyboard({ size = 'md' }: IconProps) {
  return <Icon icon={Keyboard} size={size} />
}

/** 快照：相机。 */
export function IconSnapshot({ size = 'md' }: IconProps) {
  return <Icon icon={Camera} size={size} />
}

/** 主题与颜色：色滴（与「外观」的调色板区分开）。 */
export function IconPalette({ size = 'md' }: IconProps) {
  return <Icon icon={Droplet} size={size} />
}

/** 字体与文字：排版 T。 */
export function IconTypography({ size = 'md' }: IconProps) {
  return <Icon icon={Type} size={size} />
}

/** 关于与隐私：信息圈 */
export function IconAbout({ size = 'md' }: IconProps) {
  return <Icon icon={Info} size={size} />
}

/** 编辑服务名称与连接配置。 */
export function IconEdit({ size = 'md' }: IconProps) {
  return <Icon icon={Pencil} size={size} />
}

/** 删除自定义模型服务。 */
export function IconDelete({ size = 'md' }: IconProps) {
  return <Icon icon={Trash2} size={size} />
}

/** 下载用户导入的协议文件。 */
export function IconDownload({ size = 'md' }: IconProps) {
  return <Icon icon={Download} size={size} />
}

/** 打开服务行菜单。 */
export function IconMoreVertical({ size = 'md' }: IconProps) {
  return <Icon icon={EllipsisVertical} size={size} />
}

/** 拖动排序把手。 */
export function IconGrip({ size = 'md' }: IconProps) {
  return <Icon icon={GripVertical} size={size} />
}

/** 搜索模型服务。 */
export function IconSearch({ size = 'md' }: IconProps) {
  return <Icon icon={Search} size={size} />
}

/** 按启用状态筛选。 */
export function IconFilter({ size = 'md' }: IconProps) {
  return <Icon icon={Funnel} size={size} />
}

/** 上传渠道头像。 */
export function IconImageUpload({ size = 'md' }: IconProps) {
  return <Icon icon={ImageUp} size={size} />
}

/** 恢复内置头像。 */
export function IconResetAvatar({ size = 'md' }: IconProps) {
  return <Icon icon={RotateCcw} size={size} />
}

/** 打开服务资料编辑。 */
export function IconGear({ size = 'md' }: IconProps) {
  return <Icon icon={Settings} size={size} />
}

/** 关闭浮层。 */
export function IconClose({ size = 'md' }: IconProps) {
  return <Icon icon={X} size={size} />
}
