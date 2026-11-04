import { describe, expect, it } from 'vitest'
import {
  AGENT_ORB_SIZE,
  AGENT_SHELL_GAP,
  agentShellStateForActivation,
  clampAgentOrbY,
  resizeAgentShellForAreaChange,
  type AgentShellState,
  type AgentWorkArea,
} from './agentShellLayout'

/**
 * 「面板已开 + 窄视口」时浮球被面板压住 —— **已知设计，不是 bug**。
 *
 * #735 / #880 的口径：壳层开合**不改变浮球坐标**，浮球属于画布视口；面板是覆盖层，
 * 1024×700 这类窄视口下它会盖住浮球的一部分。产品若要改成「面板开着就把球挪开」，
 * 是**另一个决策**，必须单独做（会与「用户摆好的位置不许被平移」冲突）。
 *
 * 这份测试只钉住现状，防止以后改 clamp 时**无意**改变这条边界。
 */

/** 1024×700、侧栏 64 宽：surface 的可用区域（不含面板）。 */
const NARROW_SURFACE: AgentWorkArea = {
  x: 64,
  y: 48,
  width: 1024 - 64,
  height: 700 - 48,
}
/** 同一个 surface，但把面板宽度（420）也算进右缘（`measureCanvasWorkArea()` 的算法）。 */
const NARROW_WITH_PANEL: AgentWorkArea = {
  ...NARROW_SURFACE,
  width: NARROW_SURFACE.width + 420,
}
const NARROW_AVAILABLE_WIDTH = 1024 - 64 - AGENT_SHELL_GAP

const surfaceMaxX =
  NARROW_SURFACE.x + NARROW_SURFACE.width - AGENT_ORB_SIZE - AGENT_SHELL_GAP
const surfaceMaxY =
  NARROW_SURFACE.y + NARROW_SURFACE.height - AGENT_ORB_SIZE - AGENT_SHELL_GAP

const state = (orb: { x: number; y: number }): AgentShellState => ({
  orb,
  width: 420,
})

describe('浮球与 Agent 面板重叠（已知设计）', () => {
  it('面板开合不改浮球坐标：只重算宽度，orb 连引用都不换', () => {
    const before = state({ x: 900, y: 500 })

    const after = resizeAgentShellForAreaChange(before, NARROW_AVAILABLE_WIDTH)

    expect(after.orb).toBe(before.orb)
  })

  it('面板宽度不进 orb 的 clamp：含面板的 area 与纯 surface 的 area 结果一致', () => {
    const before = state({ x: 900, y: 500 })

    const surfaceOnly = resizeAgentShellForAreaChange(
      before,
      NARROW_AVAILABLE_WIDTH,
      NARROW_SURFACE,
    )
    const panelCounted = resizeAgentShellForAreaChange(
      before,
      NARROW_AVAILABLE_WIDTH,
      NARROW_WITH_PANEL,
    )

    expect(panelCounted.orb).toEqual(surfaceOnly.orb)
    expect(surfaceOnly.orb).toBe(before.orb)
  })

  it('窄视口 + 面板已开：激活时的 orb 只按 surface 夹，面板不参与', () => {
    /** 远在右下角之外的球，用来暴露「用哪份 area」。 */
    const far = state({ x: 2000, y: 999 })

    const withSurface = agentShellStateForActivation(
      far,
      null,
      NARROW_SURFACE,
      NARROW_AVAILABLE_WIDTH,
    )
    const withPanel = agentShellStateForActivation(
      far,
      null,
      NARROW_WITH_PANEL,
      NARROW_AVAILABLE_WIDTH,
    )

    // 当前接线喂的是 surface：X 夹到 surface 右缘
    expect(withSurface.orb.x).toBe(surfaceMaxX)
    expect(withSurface.orb.y).toBe(surfaceMaxY)
    // 反证：若真把面板宽度算进去，X 会更大 —— 所以「喂哪份 area」是有意义的接线决定
    expect(withPanel.orb.x).toBeGreaterThan(withSurface.orb.x)
  })

  it('只改高度时仍然只夹 Y，X 一个像素都不动（#893 不回退）', () => {
    const before = state({ x: 900, y: 600 })
    const shorter: AgentWorkArea = { ...NARROW_SURFACE, height: 400 }

    const after = resizeAgentShellForAreaChange(
      before,
      NARROW_AVAILABLE_WIDTH,
      shorter,
    )

    expect(after.orb.x).toBe(900)
    expect(after.orb.y).toBe(
      shorter.y + shorter.height - AGENT_ORB_SIZE - AGENT_SHELL_GAP,
    )
    expect(clampAgentOrbY(before.orb, shorter).x).toBe(900)
  })
})

/**
 * ⚠️ 源码级快照（不是行为验证）：上面几条只在**喂对 area** 时才成立，
 * 所以还要钉住「AgentDock 给 activation 类 clamp 喂的是纯 surface」。
 */
describe('AgentDock 的 area 接线快照', () => {
  const dock = (): string => {
    const source = (
      import.meta.glob('./AgentDock.tsx', {
        eager: true,
        query: '?raw',
        import: 'default',
      }) as Record<string, string>
    )['./AgentDock.tsx']
    expect(source, '没读到 AgentDock.tsx').toBeTypeOf('string')
    return source ?? ''
  }

  it('activation / settle / 同宽 resize 一律用 measureCanvasWorkArea(false)', () => {
    const source = dock()
    // 面板绝不能被喂进 activation 类 clamp
    expect(source).not.toMatch(
      /agentShellStateForActivation\([\s\S]{0,200}?measureCanvasWorkArea\(\s*\)/,
    )
    // 纯 surface 的测量至少要在 activation / 同宽 resize / settle 三处出现
    expect(
      (source.match(/measureCanvasWorkArea\(false\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3)
  })

  it('只有拖动浮球时才允许把面板算进可用区域', () => {
    const source = dock()
    // `measureCanvasWorkArea()`（无参 = 含面板）只出现在拖动与 surface 变化里
    expect(source).toMatch(
      /const area = measureCanvasWorkArea\(\)[\s\S]{0,120}?kind === 'orb'/,
    )
  })
})
