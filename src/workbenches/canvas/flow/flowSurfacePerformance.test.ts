// @ts-expect-error -- tests read source CSS without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const flowCss = fs.readFileSync(new URL('./FlowSurface.module.css', import.meta.url), 'utf8')
const frameCss = fs.readFileSync(new URL('../frame/NodeFrame.module.css', import.meta.url), 'utf8')

describe('canvas detail virtualization', () => {
  it('virtualizes the React Flow node wrapper for large real-image canvases', () => {
    expect(flowCss).toMatch(
      /\.flow :global\(\.react-flow__node\)\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:/s,
    )
  })

  it('does not put label rows back inside node frames', () => {
    expect(frameCss).not.toMatch(/data-node-header-inside/)
    expect(frameCss).not.toMatch(/\.body\s*\{[^}]*content-visibility:/s)
  })

  it('keeps the normal React Flow edges and drops gesture-only layer swaps', () => {
    expect(flowCss).not.toMatch(/:global\(\.react-flow__edges\)/)
    expect(flowCss).not.toMatch(/data-flow-viewport-edge-layer/)
    expect(flowCss).not.toMatch(/data-node-type='prompt'/)
    expect(flowCss).not.toMatch(/:global\(\.react-flow__viewport\)\s*\{[^}]*will-change/s)
  })

  it('replaces only the background layer during viewport gestures', () => {
    expect(flowCss).toMatch(
      /\.surface\[data-viewport-moving='true'\] \.flow :global\(\.react-flow__background\)\s*\{[^}]*display:\s*none;/s,
    )
    expect(flowCss).toMatch(
      /\.surface\[data-viewport-moving='true'\] \.flow :global\(\.react-flow__node\)\s*\{[^}]*pointer-events:\s*none;/s,
    )
    expect(flowCss).toMatch(
      /\.surface\[data-viewport-moving='true'\] \.flow :global\(\.react-flow__node:not\(:has\(\[data-loop-node\]\)\)\)\s*\{[^}]*contain:\s*layout style;/s,
    )
  })
})
