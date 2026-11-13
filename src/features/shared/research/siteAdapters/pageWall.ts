import type { PageSnapshot } from './pageSnapshot'

/**
 * 验证页 / 登录墙识别（对账 #1088，2026-11-13）：只看提取脚本交回的快照，纯函数可单测。
 *
 * 口径（按 2026-11-13 实录的真实页面）：
 * - **人机验证**：Cloudflare（`Just a moment…` / `#challenge-form` / `cf-chl`）、AWS WAF
 *   （Dribbble 对非浏览器回的 `challenge-container` + `awswaf` 脚本，标题为空）、Sucuri
 *   （POTW 的 `sucuri_cloudproxy_js`）、hashcash（The Dieline 对无头浏览器的「Checking your browser...」）、
 *   hCaptcha / 极验整页。**拿到了站点结果就不算墙**：正常页面也可能挂着 Turnstile 脚本。
 * - **登录墙**：被跳到登录地址，或一张结果都没有而页面上有密码框；站点声明「结果卡被门挡住」
 *   （Pinterest 未登录时的 gated pin）也算——这时仍把挡住的那几张作为部分结果保留。
 * - 页面上只是有「登录」链接（The Dieline 每张卡都有 `/wp-login.php` 的收藏按钮）**不算**。
 */
export type PageWallKind = 'none' | 'challenge' | 'login'

export interface PageWall {
  kind: PageWallKind
  /** 给用户看的一句话。 */
  reason: string
}

const CHALLENGE_TITLE =
  /^(just a moment|attention required|one moment,? please|checking your browser|verify(ing)? you are (a )?human|human verification|you are being redirected|请稍候|安全验证|人机验证|访问验证|滑动验证)/i

const LOGIN_PATH = /\/(login|signin|sign-in|sign_in|session\/new|accounts\/login|account\/login|passport|auth\/login)(?:[/?#.]|$)/i

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return ''
  }
}

export interface PageWallInput {
  /** 请求打开的地址。 */
  requestedUrl: string
  /** 站点解析后拿到的有效结果数。 */
  itemCount: number
  /** 站点声明：`gatedCount > 0` 即视为登录墙（Pinterest）。 */
  gatedMeansLogin?: boolean
}

export function classifyPageWall(snapshot: PageSnapshot, input: PageWallInput): PageWall {
  const { signals } = snapshot
  if (input.gatedMeansLogin && signals.gatedCount > 0) {
    return { kind: 'login', reason: '需要登录后才能看到完整结果' }
  }
  if (input.itemCount > 0) return { kind: 'none', reason: '' }
  const titleHit = CHALLENGE_TITLE.test(snapshot.title.trim())
  if (signals.challengeMarkers.length > 0 || titleHit) {
    return { kind: 'challenge', reason: '弹出了人机验证' }
  }
  const finalPath = pathOf(snapshot.url)
  const requestedPath = pathOf(input.requestedUrl)
  if (finalPath && finalPath !== requestedPath && LOGIN_PATH.test(finalPath)) {
    return { kind: 'login', reason: '跳到了登录页' }
  }
  if (signals.passwordField) return { kind: 'login', reason: '需要登录' }
  return { kind: 'none', reason: '' }
}
