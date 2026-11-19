import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetKnifeForTest,
  isKnifeOn,
  setKnife,
  subscribeKnife,
  toggleKnife,
} from './knifeMode'

/**
 * 美工刀模式的状态机（#1159）。它是个模块级单例 ⇒ 每个用例前复位。
 * 钉住两件事：**空格点一次开 / 再点一次关**，以及**同值不重复通知**（免得白重渲）。
 */
describe('knifeMode', () => {
  beforeEach(() => {
    __resetKnifeForTest()
  })

  it('★ 默认是关的（进画布不该自带刀具）', () => {
    expect(isKnifeOn()).toBe(false)
  })

  it('★★ 空格点一下开、再点一下关', () => {
    toggleKnife()
    expect(isKnifeOn()).toBe(true)
    toggleKnife()
    expect(isKnifeOn()).toBe(false)
  })

  it('★ setKnife 同值不通知订阅者（避免每次 pointermove 都重渲）', () => {
    let hits = 0
    const off = subscribeKnife(() => {
      hits += 1
    })
    setKnife(false) // 本来就是关的
    expect(hits).toBe(0)
    setKnife(true)
    expect(hits).toBe(1)
    setKnife(true)
    expect(hits).toBe(1)
    off()
    setKnife(false)
    expect(hits).toBe(1)
  })
})
