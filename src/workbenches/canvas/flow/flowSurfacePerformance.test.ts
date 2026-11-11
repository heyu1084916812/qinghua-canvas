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

  it('keeps all node labels inside that paint-containment boundary', () => {
    expect(frameCss).toMatch(
      /\.frame\[data-node-header-inside\] \.body\s*\{[^}]*padding-top:\s*22px;/s,
    )
    expect(frameCss).not.toMatch(/\.body\s*\{[^}]*content-visibility:/s)
  })
})
