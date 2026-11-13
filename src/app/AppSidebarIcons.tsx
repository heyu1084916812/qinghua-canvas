/**
 * 应用壳侧栏的图标（架构文档 §5.10「AppShell 不得 import workbenches/canvas/*」）。
 *
 * 为什么这里仍单独一个文件、而不在业务里散着用 `<Icon>`：
 *  - 壳层是「外壳」、工作台是「插槽」；外壳反向依赖某个工作台，等于把
 *    「任何页面都要常驻」的东西绑死在「只有画布页才需要」的代码上；
 *  - 语义上这里是**一级导航**（首页 / 项目 / 技能库），与画布动作不是一套。
 *
 * 几何自「轻画-图标统一方案」第 1 批起全部来自 Lucide（`src/ui/icon`），
 * 本文件只负责「语义名 → Lucide 图标 + 默认档位」，不再手绘 path。
 * 默认档位沿用改版前的尺寸：导航项 20（lg）、新建按钮 18→md、关闭 18→md。
 */
import {
  BookOpen,
  Clapperboard,
  House,
  Icon,
  Image,
  LayoutDashboard,
  PanelLeft,
  Plug,
  Plus,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  X,
  type IconSize,
} from '../ui/icon'

interface IconProps {
  size?: IconSize
}

/** 首页 */
export function IconHome({ size = 'lg' }: IconProps) {
  return <Icon icon={House} size={size} />
}

/** 项目：一叠卡片 */
export function IconProjects({ size = 'lg' }: IconProps) {
  return <Icon icon={LayoutDashboard} size={size} />
}

/**
 * 电商工作台（对账 #384）：一只**商品袋**。
 *
 * 为什么不复用「画布」那个节点图标：两个入口是**同级但不同形态**的工作台
 * （一个是节点图、一个是表单出图），图标一样会让人以为是同一个页面。
 */
export function IconEcommerce({ size = 'lg' }: IconProps) {
  return <Icon icon={ShoppingBag} size={size} />
}

/**
 * 漫剧工作台（对账 #382）：一块**场记板**。
 *
 * 为什么不用"胶片"：胶片更像播放器；场记板一眼是"开拍前的那张表"，
 * 与这个工作台正在做的事（剧本 → 分集 → 分镜）对得上。
 */
export function IconStoryboard({ size = 'lg' }: IconProps) {
  return <Icon icon={Clapperboard} size={size} />
}

/** 画布：节点与连线 */
export function IconCanvas({ size = 'lg' }: IconProps) {
  return <Icon icon={Workflow} size={size} />
}

/** 技能库：一本打开的书 */
export function IconSkills({ size = 'lg' }: IconProps) {
  return <Icon icon={BookOpen} size={size} />
}

/** 我的素材：图片 */
export function IconAssets({ size = 'lg' }: IconProps) {
  return <Icon icon={Image} size={size} />
}

/**
 * 灵感库：火花 / 发光。
 *
 * 与「我的素材」（图片）刻意不同：那两个入口一个是**自己的产出**、
 * 一个是**外面的参考**，图标不该长得像。
 */
export function IconInspiration({ size = 'lg' }: IconProps) {
  return <Icon icon={Sparkles} size={size} />
}

/** 渠道配置：插头 / 接口 */
export function IconChannels({ size = 'lg' }: IconProps) {
  return <Icon icon={Plug} size={size} />
}

/** 侧栏展开 / 收起：一个方框 + 左侧竖线 */
export function IconSidebarToggle({ size = 'lg' }: IconProps) {
  return <Icon icon={PanelLeft} size={size} />
}

/** 新建项目：加号 */
export function IconNewProject({ size = 'md' }: IconProps) {
  return <Icon icon={Plus} size={size} />
}

/** 全局设置：两条带旋钮的滑块（比齿轮更好认） */
export function IconSettings({ size = 'lg' }: IconProps) {
  return <Icon icon={SlidersHorizontal} size={size} />
}

/** 关闭（浮层右上角）：一个叉 */
export function IconClose({ size = 'md' }: IconProps) {
  return <Icon icon={X} size={size} />
}
