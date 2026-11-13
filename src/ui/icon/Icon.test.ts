/**
 * 统一图标出口的契约（轻画-图标统一方案 §4.1 第 0 批）：
 * 尺寸三档映射、线宽按屏幕像素换算、默认装饰 / 传 label 才有名字、
 * 字符串形态与 React 形态几何与线宽一致、CSS 令牌与 JS 常量同值。
 */
// @ts-expect-error -- 项目刻意不引入 @types/node；Node fs 静态取证只属于测试。
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon, iconSvgString, ICON_GAP_PX, ICON_SIZE_PX, ICON_STROKE, Search, X } from './index'
import { gridStrokeWidth, type IconSize } from './iconTokens'

const render = (size?: IconSize, label?: string) =>
  renderToStaticMarkup(createElement(Icon, { icon: Search, size, label }))

const attr = (markup: string, name: string) =>
  markup.match(new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`))?.[1]

describe('Icon', () => {
  it('三档尺寸映射为 14 / 16 / 20，默认 md', () => {
    expect(ICON_SIZE_PX).toEqual({ sm: 14, md: 16, lg: 20 })
    expect(attr(render(), 'width')).toBe('16')
    expect(attr(render('sm'), 'width')).toBe('14')
    expect(attr(render('lg'), 'height')).toBe('20')
    expect(attr(render('lg'), 'data-icon-size')).toBe('lg')
  })

  it('线宽按屏幕像素 1.5 换算：三档在屏幕上一样粗', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const grid = Number(attr(render(size), 'stroke-width'))
      expect(grid).toBeCloseTo(gridStrokeWidth(ICON_SIZE_PX[size]), 4)
      expect((grid * ICON_SIZE_PX[size]) / 24).toBeCloseTo(ICON_STROKE, 3)
    }
  })

  it('颜色跟随 currentColor，不写死色值', () => {
    expect(attr(render(), 'stroke')).toBe('currentColor')
  })

  it('默认纯装饰：aria-hidden，不可聚焦，无 role', () => {
    const markup = render()
    expect(attr(markup, 'aria-hidden')).toBe('true')
    expect(attr(markup, 'focusable')).toBe('false')
    expect(attr(markup, 'role')).toBeUndefined()
  })

  it('传 label 时作为有名字的图形', () => {
    const markup = render('md', '搜索')
    expect(attr(markup, 'role')).toBe('img')
    expect(attr(markup, 'aria-label')).toBe('搜索')
    expect(attr(markup, 'aria-hidden')).toBeUndefined()
  })
})

describe('iconSvgString', () => {
  const inner = (markup: string) =>
    markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')

  it('与 React 形态几何一致、线宽一致', () => {
    for (const glyph of [Search, X]) {
      const react = renderToStaticMarkup(createElement(Icon, { icon: glyph, size: 'sm' }))
      const str = iconSvgString(glyph, 'sm')
      expect(inner(str)).toBe(inner(react))
      expect(attr(str, 'stroke-width')).toBe(attr(react, 'stroke-width'))
      expect(attr(str, 'width')).toBe('14')
      expect(attr(str, 'aria-hidden')).toBe('true')
    }
  })

  it('不是图标组件时报错而不是静默输出空图形', () => {
    expect(() => iconSvgString({} as never)).toThrow()
  })
})

describe('令牌同步', () => {
  // vitest 在 node 下会把 `?raw` 的 CSS stub 成空串，故直接读文件。
  const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim()

  it('CSS 的 --icon-* 与 JS 常量同值', () => {
    expect(token('icon-sm')).toBe(`${ICON_SIZE_PX.sm}px`)
    expect(token('icon-md')).toBe(`${ICON_SIZE_PX.md}px`)
    expect(token('icon-lg')).toBe(`${ICON_SIZE_PX.lg}px`)
    expect(token('icon-stroke')).toBe(String(ICON_STROKE))
    expect(token('icon-gap-sm')).toBe(`${ICON_GAP_PX.sm}px`)
    expect(token('icon-gap-md')).toBe(`${ICON_GAP_PX.md}px`)
    expect(token('icon-gap-lg')).toBe(`${ICON_GAP_PX.lg}px`)
  })
})
