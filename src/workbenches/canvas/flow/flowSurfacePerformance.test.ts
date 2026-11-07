// @ts-expect-error -- 项目刻意不引入 @types/node；fs 静态取证只属于测试。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(new URL('./FlowSurface.module.css', import.meta.url), 'utf8')

describe('FlowSurface 大画布视口外内容门禁', () => {
  it('每个 React Flow 节点保留视口外内容跳过绘制，避免真实图片画布缩放长帧', () => {
    expect(css).toMatch(
      /\.flow :global\(\.react-flow__node\)\s*\{\s*content-visibility:\s*auto;\s*contain-intrinsic-size:/,
    )
  })
})
