/* eslint-disable no-control-regex -- CLI 输出必须按真实 C0 / CSI 字节清理，Unicode 转义只是源码写法。 */
const CSI_OR_OSC = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
const REPLACEMENT_OR_CONTROL = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
/* eslint-enable no-control-regex */

/** CLI 输出进入界面前清掉替换符和控制字符，避免 Windows 编码不匹配时堆出菱形乱码。 */
export function readableCliOutput(text: string): string {
  const cleaned = text.replace(CSI_OR_OSC, '').replace(REPLACEMENT_OR_CONTROL, '')
  return cleaned.trim() ? cleaned : '（输出含不可显示字符，已省略）'
}

export function hasReadableCliOutput(text: string): boolean {
  return text.replace(CSI_OR_OSC, '').replace(REPLACEMENT_OR_CONTROL, '').trim().length > 0
}
