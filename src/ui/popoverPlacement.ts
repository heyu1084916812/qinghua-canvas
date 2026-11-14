/**
 * 浮层往哪边弹、要不要左右挪 —— 纯函数，只吃矩形，不认识节点与画布（可单测）。
 *
 * ## 出处（用户 2026-11-14：「循环节点的参数点击后的浮层面板被遮住了」）
 *
 * 循环节点数字控件的浮层宽 172，控件只有 67，天生要越出控件所在的那张卡。
 * 越出本身没问题，问题在**越到哪儿去**，实测三个坏方向：
 *
 *  ① 越过节点**上沿** ⇒ 落进节点标题排（`FlowNodeHeaderLayer` 整层压在节点层之上），
 *     标题既画在浮层上、又把那一格的点击吞掉（实测 `batch:2` 点不到）；
 *  ② 越过**可视边界**（节点被拖到画布最左/最右）⇒ 被画布视口裁掉，
 *     最左一列（1 / 5）连点都点不到；
 *  ③ 两头都装不下时乱翻 ⇒ 更糟：两个方向都被裁。
 *
 * 于是这里只做两件事：**装不下就往下弹**（下方没有标题排这类东西）与
 * **横着收进可视边界**；两头都装不下时保持朝上，不来回翻。
 *
 * ## 单位
 *
 * 判据全部在**屏幕像素**里比（调用方给 `getBoundingClientRect()` 的结果）；
 * 只有「间距」是世界坐标量（与 CSS 的 `calc(100% + 4px)` 同源），
 * 用缩放换算成屏幕像素后再比 —— 与 `ParamPicker.popupShiftIntoBounds` 同一个口径。
 *
 * ⚠️ 返回的 `shiftX` 是**世界坐标**位移（直接当 `margin-left` 用），调用方不要再乘缩放。
 * 左右位移用 `margin-left` 而不是 `transform`：`transform` 归居中与入场动画所有。
 */

/** 浮层与控件之间的间距（世界坐标 px，CSS 的 `calc(100% + 4px)` 必须同值） */
export const POPOVER_GAP = 4
/** 浮层与可视边界之间至少留的空白（**屏幕**像素） */
export const POPOVER_EDGE = 8

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PopoverPlacement {
  /** `true` = 朝下弹（越过控件所在容器的下沿，落在空白处） */
  below: boolean
  /** 水平方向收进可视边界所需的**世界坐标**位移（正 = 往右） */
  shiftX: number
}

export interface PlacementInput {
  /** 触发控件（按钮）的屏幕矩形 */
  anchor: Rect
  /**
   * 上方不许越过的容器矩形（循环节点里就是「节点框」）。
   * 只用得上沿：容器上方那条带子里有别的层（标题排），浮层进不去。
   */
  ceiling: Rect
  /** 可视边界的屏幕矩形（循环节点里就是画布视口） */
  bounds: Rect
  /** 浮层本身的屏幕尺寸 */
  popover: { width: number; height: number }
}

/**
 * 水平方向收进边界所需的**屏幕**像素位移。
 *
 * 放得下就 0；比边界还宽时贴左（与阅读起点对齐），不来回抖。
 * 这段数学与 `ParamPicker.popupShiftIntoBounds` 相同，各留一份：
 * 本文件是 `ui` 层的通用件，不该反过来依赖某个具体面板组件。
 */
export function shiftIntoBounds(
  pop: { left: number; right: number },
  bounds: { left: number; right: number },
  edge = POPOVER_EDGE,
): number {
  const minLeft = bounds.left + edge
  const maxRight = bounds.right - edge
  if (pop.left < minLeft) return minLeft - pop.left
  if (pop.right > maxRight) return Math.max(minLeft - pop.left, maxRight - pop.right)
  return 0
}

export function placePopover(input: PlacementInput, zoom: number): PopoverPlacement {
  const scale = zoom > 0 ? zoom : 1
  const gap = POPOVER_GAP * scale
  const { anchor, ceiling, bounds, popover } = input

  /** 容器内、控件上方还剩多少屏幕像素 —— 浮层装进这一段才不会越过容器上沿 */
  const roomAbove = anchor.top - ceiling.top
  /** 可视边界里、控件下方还剩多少屏幕像素（往下弹时它落在空白处） */
  const roomBelow = bounds.bottom - anchor.bottom
  const needed = popover.height + gap
  const below = roomAbove < needed && roomBelow >= needed

  const center = (anchor.left + anchor.right) / 2
  const left = center - popover.width / 2
  const shiftScreen = shiftIntoBounds(
    { left, right: left + popover.width },
    { left: bounds.left, right: bounds.right },
  )
  return { below, shiftX: shiftScreen / scale }
}
