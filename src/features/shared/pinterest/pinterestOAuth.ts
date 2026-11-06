export interface PinterestOAuthCallback {
  code: string
  state: string
}

export function isPinterestLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' ||
        url.hostname === 'localhost' ||
        url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

export function parsePinterestCallbackInput(
  value: string,
  expectedState: string,
): PinterestOAuthCallback {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('请粘贴完整回调地址')
  }
  const error =
    url.searchParams.get('error_description') ??
    url.searchParams.get('error')
  if (error) throw new Error(error)
  const code = url.searchParams.get('code')?.trim() ?? ''
  const state = url.searchParams.get('state')?.trim() ?? ''
  if (!code) throw new Error('回调地址缺少 code')
  if (!expectedState) throw new Error('请先开始 Pinterest 授权')
  if (!state) throw new Error('回调地址缺少 state')
  if (state !== expectedState) throw new Error('回调 state 不匹配')
  return { code, state }
}
