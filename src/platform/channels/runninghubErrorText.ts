/**
 * RunningHub 错误码 → 人话（从 `runninghub.ts` 搬出，对账 #1126）。
 *
 * 搬出来的原因：v2 提交 / 上传（`runninghubV2.ts`）与工作流模块也要用同一套翻译，
 * 而它们被 `runninghub.ts` 引用——留在适配器里会形成循环依赖。`runninghub.ts` 原样再导出。
 */
export interface RhErrorEnvelope {
  code?: number | string
  msg?: string
  message?: string
  errorCode?: string
  errorMessage?: string
}

/**
 * 429 / 5xx 之外的服务端错误码 → 给用户看得懂的话（含充值 / 取 Key 的去处）。
 *
 * **导出供单测**：这是"把上游代码翻成人话"的唯一入口，分支**顺序**本身就是规格 ——
 * 2026-11-14 就栽过一次：`821`（付费积分不足）的原文里带"余额不足"，
 * 排在通用的 `812 / 余额` 分支后面会被吃掉，用户看到的就变成含混的"额度不够"。
 */
export function describeRhError(res: RhErrorEnvelope, fallback: string): string {
  const message = res.errorMessage || res.msg || res.message || fallback
  const code = String(res.errorCode ?? res.code ?? '')
  /**
   * `821` = **付费积分不足**（2026-11-14 真机：应用与工作流两条提交都回这句原话
   * "付费积分余额不足，消费级 API 调用仅支持使用付费积分，免费积分不可用于 API 调用"）。
   * ⚠️ 这条**必须排在 812/余额 那条前面**：它的原文里也带"余额不足"两个字，
   * 放后面会被通用分支吃掉，用户看到的就变成"这个账号额度不够"，而不是"免费积分不能用"。
   * `accountStatus` 里的 `remainPoint` 可能显示还有分 —— **那是免费积分**，API 调用不认它。
   */
  if (code === '821') {
    return `${message}（API 调用只吃「付费积分」；「免费积分」不能用。去 runninghub.cn 充值付费积分再看）`
  }
  /**
   * `1014` = **标准模型 API 只对企业级-共享 Key 开放**（2026-11-14 真机实测：消费级 Key 打
   * `price-preview` 与标准模型端点都回 "Standard Model API is restricted to Enterprise-Shared API Keys only"）。
   *
   * ⚠️ **必须排在鉴权那条前面**：它的原文里有 "API Keys"，会被 `/key/i` 那条正则吃掉，
   * 于是账号等级问题被误报成"你的 Key 填错了"——这正是单测 `runninghubErrors.test.ts` 钉住的顺序。
   */
  if (code === '1014') {
    return `${message}（这条是账号等级限制：标准模型 API 只对企业级-共享 Key 开放；消费级 Key 请改用 app: 应用或工作流）`
  }
  if (code === '812' || /余额|balance|insufficient/i.test(message)) {
    /**
     * 812 = 这一行 Key 所属账号的额度不足。**别再讲"金额 Key / 币 Key"**（2026-11-14 实测作废）：
     * 一把 Key 同时管标准模型与 `app:` 应用，扣哪本账看账号类型与 `settleMode`。
     */
    return `${message}（这个账号的额度不够：去 runninghub.cn 充值 / 看积分；同一条 Key 也能跑 app: 应用，价格不同）`
  }
  if (/auth|token|key|401|403/i.test(`${code} ${message}`)) {
    return `${message}（检查这一行的 Key：一条渠道只需要一个 Key，标准模型 / app: / workflow: 全用它）`
  }

  /**
   * `1007` = **输入没过服务端的参数校验**（2026-10-08 实测两次：坏掉的 base64 图
   * →「Failed to upload Base64 image」、提示词只有 3 个字 →「field 'prompt' length 3
   * is less than the minimum length 5」）。这句原话是英文且看不出该改哪儿，
   * 所以前面补一句中文：**问题出在这次请求的参数上，不是网络也不是 Key**。
   *
   * 注意：这类约束（比如提示词最短 5 字）**官方目录里一个字都没写**，
   * 是服务端自己判的 —— 所以这里只做"翻译"，**不自己编一个字数门槛**。
   */
  if (code === '1007') {
    return `这次请求的参数没通过服务端校验：${message}`
  }
  return message
}
