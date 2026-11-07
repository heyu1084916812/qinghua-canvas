import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AboutPanel } from './AboutPanel'

const html = renderToStaticMarkup(createElement(AboutPanel))

describe('AboutPanel storage copy', () => {
  it('describes the shared-store default without the obsolete per-origin IndexedDB claim', () => {
    expect(html).toContain('默认写入本机的 shared-store 权威库')
    expect(html).toContain('具体数据目录以「设置 → 存储」显示为准')
    expect(html).not.toContain('网页版是浏览器的数据库（IndexedDB）')
  })

  it('does not turn the storage description into a hardcoded port or data path', () => {
    const firstBlock = html.slice(
      html.indexOf('数据存放在哪'),
      html.indexOf('什么时候会联网'),
    )
    expect(firstBlock).not.toMatch(/18765|18767|%LOCALAPPDATA%|shared-store-v1|data-v2/)
  })

  it('describes only the licenses actually shipped and marks Dexie as migration-only', () => {
    expect(html).toContain('Dexie 仅用于读取旧浏览器库迁移')
    expect(html).toContain('当前安装包单独附带 FFmpeg 的 LICENSE / NOTICE')
    expect(html).toContain('其他第三方许可仍以各自依赖包中的 LICENSE 为准')
    expect(html).not.toContain('完整许可条文在各自依赖包的 LICENSE 文件里，随包分发')
  })
})
