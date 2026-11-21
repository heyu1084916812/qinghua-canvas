import { describe, expect, it } from 'vitest'
import { HUD_MOTION, hudMotionFrames, hudMotionTiming } from './useHudMotion'

describe('HUD motion contract', () => {
  it('keeps the functional bar aligned with its positioning host', () => {
    expect(hudMotionFrames('bar', false).map((frame) => frame.transform)).toEqual([
      'translate3d(0, 14px, 0) scale(0.92)',
      'translate3d(0, 0, 0) scale(1)',
    ])
    expect(JSON.stringify(hudMotionFrames('bar', true))).not.toContain('translateX')
  })

  it('matches the reference timing for both HUD layers', () => {
    expect(hudMotionTiming('bar', false)).toMatchObject({
      duration: 300,
      delay: 0,
      easing: HUD_MOTION.easeIn,
    })
    expect(hudMotionTiming('bar', true)).toMatchObject({
      duration: 210,
      easing: HUD_MOTION.easeOut,
    })
    expect(hudMotionTiming('panel', false)).toMatchObject({
      duration: 340,
      delay: 30,
      easing: HUD_MOTION.easeIn,
    })
    expect(hudMotionTiming('panel', true)).toMatchObject({
      duration: 230,
      easing: HUD_MOTION.easeOut,
    })
  })

  it('uses the same bounded stagger for the creation-panel sections', () => {
    expect(HUD_MOTION.part).toEqual({
      enterMs: 260,
      enterDelayMs: 65,
      staggerMs: 48,
      enterY: 8,
    })
  })
})
