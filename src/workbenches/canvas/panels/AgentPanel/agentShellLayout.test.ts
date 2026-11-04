import { describe, expect, it } from 'vitest'
import {
  AGENT_ORB_SIZE,
  AGENT_SHELL_GAP,
  AGENT_SHELL_SNAP_THRESHOLD,
  AGENT_SHELL_WIDTH_DEFAULT,
  AGENT_SHELL_WIDTH_MIN,
  agentShellMaxWidth,
  agentShellAvailableWidth,
  agentShellSnapWidths,
  agentShellStateForActivation,
  agentShellWidth,
  clampAgentOrb,
  clampAgentOrbY,
  clampAgentShellState,
  dampAgentShellWidth,
  defaultAgentShellState,
  nearestAgentShellSnap,
  parseAgentShellState,
  parseLegacyAgentShellState,
  resizedAgentShellWidth,
  resizeAgentShellForAreaChange,
  shouldClampAgentOrbToSurface,
  type AgentWorkArea,
} from './agentShellLayout'

const AREA: AgentWorkArea = { x: 64, y: 48, width: 1200, height: 800 }

describe('Agent shell layout', () => {
  it('面板开合的 area change 只重算宽度，不移动 orb', () => {
    const state = {
      orb: { x: 740, y: 120 },
      width: 1376,
    }
    const next = resizeAgentShellForAreaChange(state, 1024)
    expect(next.orb).toBe(state.orb)
    expect(next.width).toBe(agentShellWidth(state.width, 1024))
  })

  it('只有首次激活或视口宽度变化才 surface clamp orb', () => {
    expect(shouldClampAgentOrbToSurface(null, 1440)).toBe(true)
    expect(shouldClampAgentOrbToSurface(1440, 1440)).toBe(false)
    expect(shouldClampAgentOrbToSurface(1440, 1024)).toBe(true)
    expect(shouldClampAgentOrbToSurface(1024, 1440)).toBe(true)
  })

  it('cleanup 保留 viewport token，同宽重新激活不夹 orb', () => {
    let lastViewportWidth: number | null = null
    expect(shouldClampAgentOrbToSurface(lastViewportWidth, 1280)).toBe(
      true,
    )
    lastViewportWidth = 1280
    // activation cleanup 不重置 token
    expect(shouldClampAgentOrbToSurface(lastViewportWidth, 1280)).toBe(
      false,
    )
  })

  it('keeps the orb inside the canvas and uses the shell default width', () => {
    const state = defaultAgentShellState(AREA)
    expect(state.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_SHELL_GAP)
    expect(state.width).toBe(AGENT_SHELL_WIDTH_DEFAULT)
  })

  it('clamps the orb without moving it when already inside the work area', () => {
    const point = { x: AREA.x + 120, y: AREA.y + 240 }
    expect(clampAgentOrb(point, AREA)).toEqual(point)
  })

  it('keeps panel width between the minimum and the current viewport width', () => {
    expect(agentShellWidth(100, 1440)).toBe(AGENT_SHELL_WIDTH_MIN)
    expect(agentShellMaxWidth(1920)).toBe(1890)
    expect(agentShellWidth(5000, 1920)).toBe(1890)
    expect(resizedAgentShellWidth(420, 800, 700, 1440)).toBe(520)
  })

  it('uses the shell available width for 30/60/80 snap levels', () => {
    const available = agentShellAvailableWidth(1440, 64)
    expect(available).toBe(1361)
    expect(agentShellSnapWidths(available)).toEqual([399, 799, 1065])
    expect(nearestAgentShellSnap(785, available)).toBe(799)
    expect(nearestAgentShellSnap(750, available)).toBeNull()
  })

  it('dampens dragging near a snap level without changing the stored value', () => {
    const available = agentShellAvailableWidth(1440, 64)
    const snap = nearestAgentShellSnap(785, available)
    expect(snap).toBe(799)
    expect(dampAgentShellWidth(785, available)).toBeGreaterThan(785)
    expect(dampAgentShellWidth(785, available)).toBeLessThan(799)
    expect(dampAgentShellWidth(799 + AGENT_SHELL_SNAP_THRESHOLD * 2, available)).toBe(
      799 + AGENT_SHELL_SNAP_THRESHOLD * 2,
    )
  })

  it('clamps persisted state against the current viewport', () => {
    const state = clampAgentShellState(
      { orb: { x: 99999, y: -99999 }, width: 99999 },
      AREA,
      1024,
    )
    expect(state.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_SHELL_GAP)
    expect(state.orb.y).toBe(AREA.y + AGENT_SHELL_GAP)
    expect(state.width).toBe(994)
  })

  it('重新激活时对既有 shell 按 1024 surface 重新 clamp', () => {
    const wide: AgentWorkArea = {
      x: 64,
      y: 0,
      width: 1376,
      height: 900,
    }
    const narrow: AgentWorkArea = {
      x: 64,
      y: 0,
      width: 510,
      height: 670,
    }
    const fromWide = {
      orb: { x: 1310, y: 810 },
      width: 420,
    }
    expect(
      clampAgentShellState(
        fromWide,
        wide,
        agentShellAvailableWidth(1440, 64),
      ),
    ).toEqual(fromWide)

    const reactivated = agentShellStateForActivation(
      fromWide,
      null,
      narrow,
      agentShellAvailableWidth(1024, 64),
    )
    expect(reactivated.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(
      narrow.x + narrow.width - AGENT_SHELL_GAP,
    )
    expect(reactivated.orb.y + AGENT_ORB_SIZE).toBeLessThanOrEqual(
      narrow.y + narrow.height - AGENT_SHELL_GAP,
    )
    expect(reactivated.width).toBe(420)
  })

  it('restores v2 state and migrates only the orb from v1', () => {
    expect(
      parseAgentShellState(JSON.stringify({ orb: { x: 640, y: 420 }, width: 480 })),
    ).toEqual({
      orb: { x: 640, y: 420 },
      width: 480,
    })
    expect(
      parseLegacyAgentShellState(
        JSON.stringify({
          orb: { x: 300, y: 260 },
          panel: { x: 10, y: 20, width: 380, height: 500 },
        }),
      ),
    ).toEqual({
      orb: { x: 300, y: 260 },
      width: 380,
    })
  })

  it('ignores corrupt persisted state', () => {
    expect(parseAgentShellState('{')).toBeNull()
    expect(parseAgentShellState(JSON.stringify({ orb: { x: 1, y: 2 } }))).toBeNull()
    expect(parseLegacyAgentShellState(JSON.stringify({ panel: { width: 380 } }))).toBeNull()
  })
})

/**
 * 窗口只改高度（拖下边框、任务栏变化）时，浮球的 Y 必须被重夹回 surface；
 * 但宽度没变就**一个像素都不许动 X** —— 否则用户摆好的水平位置会被平移。
 */
describe('浮球在高度变化时只重夹 Y', () => {
  it('只改高度：Y 夹回 surface 内，X 完全不变', () => {
    const state = { orb: { x: 1100, y: 780 }, width: 700 }
    const shorter: AgentWorkArea = { ...AREA, height: 600 }
    const expectedY = AREA.y + 600 - AGENT_ORB_SIZE - AGENT_SHELL_GAP

    const next = resizeAgentShellForAreaChange(state, 1360, shorter)

    expect(next.orb.x).toBe(1100)
    expect(next.orb.y).toBe(expectedY)
    // 宽度没变 ⇒ 宽度也算回去，但 orb 只动 Y
    expect(next.width).toBe(agentShellWidth(700, 1360))
  })

  it('只改宽度：orb 完全不动（与拆分前一致）', () => {
    const state = { orb: { x: 700, y: 300 }, width: 500 }

    const next = resizeAgentShellForAreaChange(state, 1024, AREA)

    expect(next.orb).toEqual(state.orb)
    expect(next.width).toBe(agentShellWidth(500, 1024))
  })

  it('不传 area（面板开合路径）时 orb 连对象身份都不换', () => {
    const state = { orb: { x: 740, y: 120 }, width: 1376 }

    const next = resizeAgentShellForAreaChange(state, 1024)

    expect(next.orb).toBe(state.orb)
  })

  it('clamp 是幂等的：clamp(clamp(x)) === clamp(x)', () => {
    const area: AgentWorkArea = { x: 0, y: 0, width: 800, height: 500 }

    const once = clampAgentOrbY({ x: 10, y: 999 }, area)
    expect(clampAgentOrbY(once, area)).toEqual(once)

    const full = clampAgentOrb({ x: -50, y: 999 }, area)
    expect(clampAgentOrb(full, area)).toEqual(full)

    const shell = clampAgentShellState(
      { orb: { x: -50, y: 999 }, width: 9999 },
      area,
      700,
    )
    expect(clampAgentShellState(shell, area, 700)).toEqual(shell)
    // 已经是合法值时，重夹一次必须原样返回
    expect(clampAgentOrbY({ x: 10, y: 200 }, area)).toEqual({ x: 10, y: 200 })
  })

  it('surface 比浮球还小时退化到上边界，不出负数或 NaN', () => {
    const tiny: AgentWorkArea = { x: 0, y: 0, width: 40, height: 40 }

    const next = clampAgentOrbY({ x: 123, y: 456 }, tiny)

    expect(next.x).toBe(123)
    expect(next.y).toBe(AGENT_SHELL_GAP)
    expect(Number.isFinite(next.y)).toBe(true)
    expect(next.y).toBeGreaterThanOrEqual(0)
  })

  it('非法输入（NaN / 非有限 area）不产生 NaN', () => {
    const nanY = clampAgentOrbY({ x: 5, y: Number.NaN }, AREA)
    expect(nanY.x).toBe(5)
    expect(Number.isFinite(nanY.y)).toBe(true)
    expect(nanY.y).toBe(AREA.y + AGENT_SHELL_GAP)

    const brokenArea = clampAgentOrbY(
      { x: 5, y: 400 },
      { ...AREA, height: Number.NaN },
    )
    expect(Number.isFinite(brokenArea.y)).toBe(true)
  })
})
