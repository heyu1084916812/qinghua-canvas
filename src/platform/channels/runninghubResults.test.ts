import { describe, expect, it } from 'vitest'
import { resultUrlsOf } from './runninghub'

/**
 * 产物地址的三种形状（2026-11-14 按官方文档核对后补的回归）。
 *
 * 依据：官方文档「查询任务生成结果 V2」`POST /openapi/v2/query` 回 `results[{url, outputType}]`；
 * 「查询任务生成结果」`POST /task/openapi/outputs`（文档标注**将废弃**）与 webhook 的 `eventData`
 * 回 `[{fileUrl, fileType, nodeId}]`。只认第一种时，旧接口或回调那条路上
 * 「任务成功、有产物」会被判成「没有产物」——这条单测就是钉住这件事。
 */
describe('resultUrlsOf', () => {
  it('V2 query 的 url 优先', () => {
    expect(resultUrlsOf([{ url: 'https://a/1.png', outputType: 'png' }])).toEqual([
      'https://a/1.png',
    ])
  })

  it('旧 outputs / webhook 的 fileUrl 也认', () => {
    expect(resultUrlsOf([{ fileUrl: 'https://a/2.png', fileType: 'png' }])).toEqual([
      'https://a/2.png',
    ])
  })

  it('outputUrl 兼容项仍在（历史数据）', () => {
    expect(resultUrlsOf([{ outputUrl: 'https://a/3.mp4' }])).toEqual(['https://a/3.mp4'])
  })

  it('多产物保持服务端顺序（第一张是主图）', () => {
    expect(
      resultUrlsOf([
        { url: 'https://a/first.png' },
        { fileUrl: 'https://a/second.png' },
        { url: 'https://a/third.png' },
      ]),
    ).toEqual(['https://a/first.png', 'https://a/second.png', 'https://a/third.png'])
  })

  it('空串与非字符串一律丢掉（不许把 undefined 拼进下载队列）', () => {
    expect(
      resultUrlsOf([
        { url: '' },
        { url: undefined, fileUrl: undefined },
        { text: '只有文本的条目' } as never,
        { url: 'https://a/ok.png' },
      ]),
    ).toEqual(['https://a/ok.png'])
  })
})
