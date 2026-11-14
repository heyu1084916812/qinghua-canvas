/**
 * RunningHub `accountStatus` 的读数 → 状态行上的一句事实（对账 #1114）。
 *
 * 为什么单独一个文件：`runninghub.ts` 是**超千行的改编排模块**（模块治理把它钉在
 * 951 行的基线内），这种纯格式化逻辑放进去会顶破预算；而它本身没有网络、没有状态，
 * 单测也更省事。
 *
 * 三条口径：
 * 1. `remainMoney`（金额 CNY）/ `remainCoins`（RH 币）/ `remainPoint`（积分）是**三种单位**，
 *    不能相加，也不能换算（换算比例官方没公开，见调研文档 §九 C）；
 * 2. 积分只报数，**必须带一句"免费积分不能用于 API"**——#1110 实测：显示 30 分，
 *    提交照样回 `821 付费积分余额不足`；
 * 3. `apiType` 决定"能调什么"：`NORMAL` 消费级（只能 AI 应用 / 工作流）、
 *    `SHARED` 企业共享（标准模型也开放）。不写这一项等于把权限差异藏起来。
 */

/** 余额字段可能是数字也可能是字符串；空值 / null 一律当"没有这一项"（不编 0）。 */
function moneyTextOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

export function rhAccountNote(data: unknown): string {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const parts: string[] = []
  const money = moneyTextOf(record.remainMoney)
  if (money) parts.push(`金额 ¥${money}`)
  const coins = moneyTextOf(record.remainCoins)
  if (coins) parts.push(`RH 币 ${coins}`)
  const points = moneyTextOf(record.remainPoint)
  if (points) parts.push(`积分 ${points}（免费积分不能用于 API）`)
  const apiType = typeof record.apiType === 'string' ? record.apiType : ''
  if (apiType === 'NORMAL') parts.push('消费级账号')
  else if (apiType === 'SHARED') parts.push('企业共享 Key')
  else if (apiType) parts.push(`账号类型 ${apiType}`)
  return parts.join(' · ')
}
