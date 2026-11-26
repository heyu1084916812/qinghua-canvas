/**
 * 用户原话里的出图 / 改图意图判定。
 *
 * 这些函数只读文本，不读画布或模型，因此从大型系统提示词文件拆出来，
 * 供回合准备和系统提示词共同复用。
 */
export function looksLikePreserveRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t) return false
  return /保持不变|其余不变|其他(都)?不变|其他(都)?(别|不要)(动|改)|其余(都)?(照旧|保持)|只(改|换|替换|把)|其余的?不动/.test(
    t,
  )
}

export function looksLikeStyleOnlyRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t) return false
  const styleWord = /风格|画风|质感|渲染|3d|三维|写实|卡通|动漫|水彩|油画|像素|赛博|国风|素描|手绘|黏土/i.test(
    t,
  )
  const changeWord = /换|改|变|转|做成|弄成|调成/.test(t)
  return styleWord && changeWord
}

export function looksLikeCombineRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t) return false
  return /合成|融合|拼成|拼在|组合|放在一起|放在同一张|同一张图|一张图里|一起生成|合起来/.test(t)
}

export function expectsPerImageFlows(text: string, imageCount: number): boolean {
  if (imageCount < 2) return false
  return !looksLikeCombineRequest(text)
}
