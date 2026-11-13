/**
 * 画布工具栏与菜单用的**线性图标集**（用户 2026-09-19）。
 *
 * 为什么自己画 SVG 而不用图标库：
 *   1. 仓库至今零图标依赖（工具栏一直用文本字形），为十来个图标引一整个库不划算；
 *   2. 这些图标的**形状本身有产品含义**（如「水平排列」= 三条竖条、「垂直排列」= 三条横条），
 *      用通用库反而要挑半天还未必对得上参考产品；
 *   3. 内联 SVG 能直接吃 `currentColor`，两套主题自动跟随，不额外接主题变量。
 *
 * 统一约定：
 *   - `stroke="currentColor"` + `fill="none"`，线宽 1.6（在 16px 下最接近参考产品的观感）；
 *   - 尺寸由调用方给（默认 16），不写死，方便菜单 / 按钮各取所需；
 *   - `viewBox` 一律 24×24、`strokeLinecap/Join = round`，保证视觉重量一致。
 */
import type { ReactNode, SVGProps } from 'react'
import { ArrowUp, AtSign, Bold, BookOpen, Box, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns2, Columns3, Combine, Copy, CornerUpRight, Crop, Download, Ellipsis, FlipHorizontal2, FlipVertical2, Globe, Grid3x3, Hand, Heading1, Heading2, Heading3, Icon, Image, Images, Italic, Layers, Lightbulb, Link, List, ListOrdered, LoaderCircle, Maximize2, MessageCircle, Minimize2, Minus, Palette, Pause, PenLine, Pencil, Pilcrow, Play, Plus, Power, Redo2, RefreshCw, Repeat2, RotateCcw, RotateCw, Rows3, Scan, Settings, SlidersHorizontal, Smile, Square, SquareDashed, Trash2, Type, Undo2, Ungroup, Upload, WandSparkles, Workflow, X, ZoomIn } from '../../../ui/icon'

import {
  PRESET_GLYPH_STROKE_WIDTH,
  PresetGlyphShapes,
} from '../icons/presetGlyph'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 提示词：灯泡（「灵光一现」，与参考产品一致） */
export function IconPrompt({ size = 16, ...props }: IconProps) {
  return <Icon icon={Lightbulb} px={size} {...props} />
}

/** 生成：魔杖 + 星点 */
export function IconGeneration({ size = 16, ...props }: IconProps) {
  return <Icon icon={WandSparkles} px={size} {...props} />
}

/** 对比：左右两半，一半实心 */
export function IconCompare({ size = 16, ...props }: IconProps) {
  return <Icon icon={Columns2} px={size} {...props} />
}

/** 分组：带角标的方框（「把若干节点框进出」） */
export function IconGroup({ size = 16, ...props }: IconProps) {
  return <Icon icon={SquareDashed} px={size} {...props} />
}

/** 背景色：一块色卡 + 三颗色点（"挑一块底色"） */
export function IconPalette({ size = 16, ...props }: IconProps) {
  return <Icon icon={Palette} px={size} {...props} />
}

/** 解组：三个角撑 + 一个"走出来"的箭头（分组的反面） */
export function IconUngroup({ size = 16, ...props }: IconProps) {
  return <Icon icon={Ungroup} px={size} {...props} />
}

/** 批量：叠起来的多份文件 */
export function IconBatch({ size = 16, ...props }: IconProps) {
  return <Icon icon={Layers} px={size} {...props} />
}

/** 重置视图：逆时针回转箭头 */
export function IconReset({ size = 16, ...props }: IconProps) {
  return <Icon icon={RotateCcw} px={size} {...props} />
}

/**
 * 宫格排列：九宫格。
 * 方格比等分略小、彼此留缝，这样才像「排成格子」而不是「一张底纹」。
 */
export function IconGridArrange({ size = 16, ...props }: IconProps) {
  return <Icon icon={Grid3x3} px={size} {...props} />
}

/** 水平排列：三条**竖条**（并排成一行） */
export function IconRowArrange({ size = 16, ...props }: IconProps) {
  return <Icon icon={Columns3} px={size} {...props} />
}

/** 垂直排列：三条**横条**（叠成一列） */
export function IconColumnArrange({ size = 16, ...props }: IconProps) {
  return <Icon icon={Rows3} px={size} {...props} />
}

/** 整理节点：左右两列节点 + 一条指向右的箭头（「按连线分层」） */
export function IconTidy({ size = 16, ...props }: IconProps) {
  return <Icon icon={Workflow} px={size} {...props} />
}

/** 撤销 / 重做（生成按钮的箭头也用它，见 §6.8） */
export function IconUndo({ size = 16, ...props }: IconProps) {
  return <Icon icon={Undo2} px={size} {...props} />
}

export function IconRedo({ size = 16, ...props }: IconProps) {
  return <Icon icon={Redo2} px={size} {...props} />
}

/** 导入素材：向上箭头入盘 */
export function IconImport({ size = 16, ...props }: IconProps) {
  return <Icon icon={Upload} px={size} {...props} />
}

/** 连接到已有节点：两个节点块之间一条连线（§6.14「连接已有节点」区分于「新建」） */
/**
 * 提取选区：四角取景框 + 中间一块被框住的区域（§6.23）。
 *
 * 形状取「截图取景」这一通用符号：四个直角 + 中间一个实心小块，
 * 一眼能与「导入」「全屏」区分开（那两个也是四角，但没有中间那块）。
 */
export function IconScan({ size = 16, ...props }: IconProps) {
  return <Icon icon={Scan} px={size} {...props} />
}

/**
 * 裁剪：经典「裁刀」符号 —— 两条折线交叉，读作「沿这两条边把图切小」。
 *
 * 与 `IconScan`（提取选区：四角取景框 + 中间实心块）刻意分开：
 * 那个读「框一块出来、带选区上下文」，这个读「就切这一块、不带上下文」。
 * 两者在 16px 下也不会混（这个没有中间那块实心）。
 */
export function IconCrop({ size = 16, ...props }: IconProps) {
  return <Icon icon={Crop} px={size} {...props} />
}

export function IconLink({ size = 16, ...props }: IconProps) {
  return <Icon icon={Link} px={size} {...props} />
}

/* ────────────────────────────────────────────────────────────
 * 正文格式图标（用户 2026-09-21）。
 *
 * 形状对齐「线性图标」：只描边、不填充、线宽与上面同一套（1.6 / 24×24）。
 * 标题用 **H1/H2/H3 字形**（用户参考图就是字），列表 / 分隔线 / 复制 / 全屏
 * 用图形——这也是参考图的分法：文字类格式给字形，结构类给图形。
 * ──────────────────────────────────────────────────────────── */

/**
 * 标题字形。用 `<text>` 而不是路径：这三个是**文字本身**（H1/H2/H3），
 * 画成路径反而失真；`font-size` 随 viewBox 缩放。
 *
 * ⚠️ 字号要**撑满视图**（用户 2026-09-21：「H1/H2/H3 好小啊，好扁啊」）：
 * 首版用 `font-size=11`，在 24 的视图里只占不到一半高——旁边的 B / I 是
 * 画满 24 的路径，两者放一起，H 系列明显小一圈、显扁。
 * 现在取 15 并把基线抬到 19，字形高度接近 14/24，与线性图标等重。
 * `fontWeight=700` 同理：线性图标有 1.6 的描边重量，细字压不住。
 */

export function IconH1({ size = 16, ...props }: IconProps) {
  return <Icon icon={Heading1} px={size} {...props} />
}
export function IconH2({ size = 16, ...props }: IconProps) {
  return <Icon icon={Heading2} px={size} {...props} />
}
export function IconH3({ size = 16, ...props }: IconProps) {
  return <Icon icon={Heading3} px={size} {...props} />
}

/** 正文：一个段落符号（¶），表示「取消标题 / 列表，回到普通段落」 */
export function IconParagraph({ size = 16, ...props }: IconProps) {
  return <Icon icon={Pilcrow} px={size} {...props} />
}

/** 粗体：字形 B */
export function IconBold({ size = 16, ...props }: IconProps) {
  return <Icon icon={Bold} px={size} {...props} />
}

/** 斜体：字形 I（带倾角的竖笔） */
export function IconItalic({ size = 16, ...props }: IconProps) {
  return <Icon icon={Italic} px={size} {...props} />
}

/** 无序列表：三行，行首为圆点 */
export function IconBulletList({ size = 16, ...props }: IconProps) {
  return <Icon icon={List} px={size} {...props} />
}

/** 有序列表：三行，行首为数字 */
export function IconOrderedList({ size = 16, ...props }: IconProps) {
  return <Icon icon={ListOrdered} px={size} {...props} />
}

/** 分隔线：一条横线，两侧短竖线示意「上下断开」 */
export function IconDivider({ size = 16, ...props }: IconProps) {
  return <Icon icon={Minus} px={size} {...props} />
}

/** 复制：两层叠放的方框（与跟随栏「复制」同一形状，语义一致） */
export function IconCopyText({ size = 16, ...props }: IconProps) {
  return <Icon icon={Copy} px={size} {...props} />
}

/** 全屏编辑：四角向外（进入）/ 向内（退出）由调用方翻转 */
/**
 * 循环：首尾相接的两段箭头弧（§6.22 循环节点）。
 *
 * 形状取「环形箭头」这一通用符号——两端各一个箭头，中段断开，
 * 一眼能读成「重复」。不画整圆，否则在 16px 下会与「对比」「分组」的圆角方块混淆。
 */
export function IconLoop({ size = 16, ...props }: IconProps) {
  return <Icon icon={Repeat2} px={size} {...props} />
}

/**
 * 融合：两张图**叠在一起**，右侧那张只露出一角。
 *
 * 形状取「叠图」这一通用符号，而不是「两个箭头汇合」：后者在 16px 下
 * 与「整理节点」「连接」那几枚箭头图标几乎分不出来。叠图一眼就是
 * 「两张图合成一张」，正是这个节点做的事（§6.23）。
 */
export function IconFusion({ size = 16, ...props }: IconProps) {
  return <Icon icon={Combine} px={size} {...props} />
}

export function IconExpand({ size = 16, ...props }: IconProps) {
  return <Icon icon={Maximize2} px={size} {...props} />
}

/** 放大镜（带 +）：调研图片「查看大图」。 */
export function IconZoomIn({ size = 16, ...props }: IconProps) {
  return <Icon icon={ZoomIn} px={size} {...props} />
}

export function IconCollapse({ size = 16, ...props }: IconProps) {
  return <Icon icon={Minimize2} px={size} {...props} />
}

/**
 * 新建节点：**加号**（用户 2026-09-22）。
 *
 * 为什么必须是 SVG 而不是文本 `＋`：旧版用全角加号，靠 `rotate(45deg)` 变成 ×。
 * 但**字体的字形位置不可控**——全角 `＋` 在字体盒里是偏上/偏左放置的，
 * 实测文字盒 36×46、而真实字形只占其中一部分，于是旋转时字形绕的是一颗
 * **偏心的点**，看起来「没绕自己的中心转」（用户实测反馈）。
 *
 * 换成 SVG 后，笔画由坐标定义，`viewBox` 的几何中心就是字形中心，
 * `rotate(45deg)` 绕任何容器中心转都精确——旋转中心这件事从此是确定的。
 *
 * 形状：两条等长的正交线段，端点圆头——与工具栏其它线性图标同一套约定。
 */
export function IconPlus({ size = 16, ...props }: IconProps) {
  return <Icon icon={Plus} px={size} {...props} />
}

/**
 * ── 节点功能栏（跟随栏 + 节点内功能条）的动作图标（2026-09-30）──
 *
 * 用户：「节点功能栏的图标我不要符号，我要真正的矢量图」。
 *
 * 上一版这些按钮画的是**文本字形**（`▶ ■ ✎ ⧉ ▣ ⬇ ✕ ⌄ ⚙`）。字形的问题是**位置不可控**：
 * 不同字体下字形在字体盒里的位置、宽度、基线都不同（工具栏那个全角「＋」已经栽过一次），
 * 于是「图标是否居中」这件事取决于用户机器上装了什么字体 —— 这正是要根除的东西。
 * 现在全部换成与图标集同一套约定的内联 SVG（24×24、`currentColor`、线宽 1.6、圆头）。
 */

/** 生成 / 运行：三角形（与暂停 / 停止成对） */
export function IconPlay({ size = 16, ...props }: IconProps) {
  return <Icon icon={Play} px={size} {...props} />
}

/** 暂停（视频播放中的那一下） */
export function IconPause({ size = 16, ...props }: IconProps) {
  return <Icon icon={Pause} px={size} {...props} />
}

/** 停止 / 取消生成：方块 */
export function IconStop({ size = 16, ...props }: IconProps) {
  return <Icon icon={Square} px={size} {...props} />
}

/** 重命名：铅笔 */
export function IconRename({ size = 16, ...props }: IconProps) {
  return <Icon icon={Pencil} px={size} {...props} />
}

/** 复制节点：两张叠起来的纸 */
export function IconDuplicate({ size = 16, ...props }: IconProps) {
  return <Icon icon={Copy} px={size} {...props} />
}

/** 下载：向下箭头落进托盘 */
export function IconDownload({ size = 16, ...props }: IconProps) {
  return <Icon icon={Download} px={size} {...props} />
}

/** 删除：垃圾桶（功能栏里是危险操作，形状要与普通操作区分开） */
export function IconDelete({ size = 16, ...props }: IconProps) {
  return <Icon icon={Trash2} px={size} {...props} />
}

/** 收起 / 展开：向下的折角 */
export function IconChevronDown({ size = 16, ...props }: IconProps) {
  return <Icon icon={ChevronDown} px={size} {...props} />
}

/** 向上展开：与向下折角同一套线性重量 */
export function IconChevronUp({ size = 16, ...props }: IconProps) {
  return <Icon icon={ChevronUp} px={size} {...props} />
}

/** 灯箱上一张 / 下一张：与展开箭头同一套线性重量 */
export function IconChevronLeft({ size = 16, ...props }: IconProps) {
  return <Icon icon={ChevronLeft} px={size} {...props} />
}

export function IconChevronRight({ size = 16, ...props }: IconProps) {
  return <Icon icon={ChevronRight} px={size} {...props} />
}

/** 多选灯箱：叠放的两张画面 */
export function IconGallery({ size = 16, ...props }: IconProps) {
  return <Icon icon={Images} px={size} {...props} />
}

/** 渠道设置：齿轮（线性画法，与其余图标同一套重量） */
export function IconSettings({ size = 16, ...props }: IconProps) {
  return <Icon icon={Settings} px={size} {...props} />
}

/** 筛选与排序：两条带滑块的横线，对应参考栏右上角入口。 */
export function IconSliders({ size = 16, ...props }: IconProps) {
  return <Icon icon={SlidersHorizontal} px={size} {...props} />
}

/** 关闭 / 移除：叉（标签上的「✕」也用它，字号不再决定形状） */
export function IconClose({ size = 16, ...props }: IconProps) {
  return <Icon icon={X} px={size} {...props} />
}

/** 进行中：一段圆弧（配合 CSS 旋转，替代文本 `◌`） */
export function IconSpinner({ size = 16, ...props }: IconProps) {
  return <Icon icon={LoaderCircle} px={size} {...props} />
}

/**
 * 发送：向上的箭头（Agent 对话窗的圆形发送钮）。
 *
 * 为什么是「向上」而不是纸飞机：参考产品（liblib.tv）就是这个形状，
 * 而且它在本项目里不与任何现有图标撞形 —— 工具栏的 `IconPlay` 是三角、
 * `IconImport` 是向下入盒，含义各不相干。
 */
export function IconArrowUp({ size = 16, ...props }: IconProps) {
  return <Icon icon={ArrowUp} px={size} {...props} />
}

export function IconSteer({ size = 16, ...props }: IconProps) {
  return <Icon icon={CornerUpRight} px={size} {...props} />
}

export function IconMore({ size = 16, ...props }: IconProps) {
  return <Icon icon={Ellipsis} px={size} {...props} />
}

/** 图片：山与日。步骤卡上代表「这一步产出的是一张图」 */
export function IconImage({ size = 16, ...props }: IconProps) {
  return <Icon icon={Image} px={size} {...props} />
}

/** 确认：对勾（就地改名的「保存」用它，不再用文字按钮） */
export function IconCheck({ size = 16, ...props }: IconProps) {
  return <Icon icon={Check} px={size} {...props} />
}

/**
 * 模型：**立体方块**（用户 2026-10-02：「模型用一个 3d 建模的图标展示，立体的方形」。
 * 参考产品那一排也是这个形状）。
 *
 * 画法就是等轴测立方体：六边形外框 + 顶部两条棱 + 中间一条竖线。
 * 为什么不用「芯片」「大脑」那类通用 AI 图标：这里是**模型**这一档的固定符号，
 * 它旁边还有技能 / 手动 / 自动三枚，形状必须一眼可分。
 */
export function IconModelCube({ size = 16, ...props }: IconProps) {
  return <Icon icon={Box} px={size} {...props} />
}

/**
 * 对话模型（agent 自己的 LLM）：一枚对话气泡。
 *
 * 与「模型」那个立体方块刻意分开画 —— 方块回答「用谁**建**」，
 * 气泡回答「跟谁**说**」（用户 2026-10-02：对话模型要单独放一个地方）。
 */
export function IconChat({ size = 16, ...props }: IconProps) {
  return <Icon icon={MessageCircle} px={size} {...props} />
}

/** 技能：一本打开的书。与「模型」的立体方块分开：那一个是「谁来做」，这一个是「怎么做」。 */
export function IconSkill({ size = 16, ...props }: IconProps) {
  return <Icon icon={BookOpen} px={size} {...props} />
}

/** 手动生成：一只手（参考产品同一个符号）。语义 = 每次生成前问你一句 */
export function IconManual({ size = 16, ...props }: IconProps) {
  return <Icon icon={Hand} px={size} {...props} />
}

/** 自动生成：循环箭头（同一个符号的「不必问你」那一档） */
export function IconAuto({ size = 16, ...props }: IconProps) {
  return <Icon icon={RefreshCw} px={size} {...props} />
}

/** 联网：地球（Agent 输入框的「联网」开关） */
export function IconGlobe({ size = 16, ...props }: IconProps) {
  return <Icon icon={Globe} px={size} {...props} />
}

/** 引用（@）：在输入框里引用画布节点或模型 */
export function IconMention({ size = 16, ...props }: IconProps) {
  return <Icon icon={AtSign} px={size} {...props} />
}

/**
 * 星标（收藏用）。`filled` = 已收藏 —— 同一个形状两种填充，
 * 比「实心星 / 空心星」画两遍更不容易走样。
 */
export function IconStar({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" />
    </Svg>
  )
}

/**
 * 预设（**第三版**，用户 2026-10-06 再次给了参考图）：四个圆角方块、右上一个转 45°。
 *
 * 三版演进值得记一笔，因为它说明"参考图"与"可读性"是两件事：
 *  - 第 1 版：四格方块 —— 用户说「不要」（还与工具栏的「排列」图标撞脸）；
 *  - 第 2 版：菱形 / 圆 / 方 / 十字（用户当时那张构成图）—— 四个部件**挤在画布中间一半**，
 *    缩到 18~21px 就成了一小撮（用户 2026-10-06：「里面的四个部件显得太拥挤了」）；
 *  - 第 3 版（本版）：**占满画布**的四枚圆角方块 + 右上转 45°，线宽按方块边长的 1/6。
 *
 * 几何定义在 `icons/presetGlyph.tsx`（**单一来源**）：同一个图形还要以 SVG 字符串的形式
 * 进正文里那枚 chip（编辑器是命令式建 DOM），两处必须逐字一致。
 */
export function IconPreset(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={PRESET_GLYPH_STROKE_WIDTH}>
      <PresetGlyphShapes />
    </Svg>
  )
}

/** 情绪：一张脸（用户 2026-10-05 第 14 条后半那份「情绪调节」） */
export function IconEmotion({ size = 16, ...props }: IconProps) {
  return <Icon icon={Smile} px={size} {...props} />
}

/** 旋转：一个方块 + 绕它一圈的箭头（用户 2026-10-05 第 10 条的「旋转」入口） */
export function IconRotate({ size = 16, ...props }: IconProps) {
  return <Icon icon={RotateCw} px={size} {...props} />
}

/** 标注：一支笔 + 一道下划线（用户 2026-10-05 第 10 条的「标注」入口） */
export function IconAnnotate({ size = 16, ...props }: IconProps) {
  return <Icon icon={PenLine} px={size} {...props} />
}

/** 左右镜像：一条竖虚线 + 两侧的三角（用户 2026-10-05 第 10 条的「左右镜像」） */
export function IconMirrorH({ size = 16, ...props }: IconProps) {
  return <Icon icon={FlipHorizontal2} px={size} {...props} />
}

/** 上下镜像：一条横虚线 + 上下两个三角 */
export function IconMirrorV({ size = 16, ...props }: IconProps) {
  return <Icon icon={FlipVertical2} px={size} {...props} />
}

/** 矩形（标注工具里那枚「画框」） */
export function IconRect({ size = 16, ...props }: IconProps) {
  return <Icon icon={Square} px={size} {...props} />
}

/** 文字（标注工具里那枚「T」） */
export function IconText({ size = 16, ...props }: IconProps) {
  return <Icon icon={Type} px={size} {...props} />
}

/** 禁用 / 启用：电源符号（顶部竖线 + 带缺口的圆环） */
export function IconPower({ size = 16, ...props }: IconProps) {
  return <Icon icon={Power} px={size} {...props} />
}
