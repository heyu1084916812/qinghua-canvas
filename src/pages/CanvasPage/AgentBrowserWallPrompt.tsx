import { useState, useSyncExternalStore } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  answerBrowserWall,
  BROWSER_WALL_HEADLINE,
  browserWallDetail,
  browserWallStore,
} from '../../features/shared/research/agentBrowserWall'
import { Check, CircleAlert, ExternalLink, Icon } from '../../ui/icon'
import styles from './AgentBrowserWallPrompt.module.css'

/**
 * 「需要你处理一下验证/登录，完成后点继续」提示卡（对账 #1088，2026-11-13）。
 *
 * Agent 调研在后台浏览器里遇到验证 / 登录墙时，`browserSiteRun` 先把那个窗口亮出来，再经
 * `requestBrowserWall` 挂一条待办；这里读待办，给三个动作：继续（处理完了，重新提取）/
 * 显示窗口（窗口被挡住或最小化了，再亮一次）/ 取消（这个站这次跳过）。
 * 一次只显示最早的一条，后面还有几条写在标题旁。挂在画布舞台底部、工具条上方。
 */
export function AgentBrowserWallPrompt() {
  const prompts = useSyncExternalStore(browserWallStore.subscribe, browserWallStore.get, browserWallStore.get)
  const platform = usePlatform()
  const [showFailed, setShowFailed] = useState<string | null>(null)
  const prompt = prompts[0]
  if (!prompt) return null
  const agentBrowser = platform.agentBrowser
  const what = prompt.kind === 'login' ? '请登录' : '请完成验证'
  return (
    <section
      className={styles.card}
      role="alert"
      aria-live="assertive"
      aria-label={`${prompt.label}${what}`}
      data-agent-browser-wall={prompt.siteId}
      data-wall-kind={prompt.kind}
      data-browser-occluder
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon icon={CircleAlert} size="md" />
      </span>
      <div className={styles.body}>
        <p className={styles.title}>
          {BROWSER_WALL_HEADLINE}
          {prompts.length > 1 ? <span className={styles.more}>另有 {prompts.length - 1} 个站点在等</span> : null}
        </p>
        <p className={styles.detail}>{browserWallDetail(prompt)}</p>
        {showFailed === prompt.key ? <p className={styles.error}>窗口没能打开，可以先点「取消」跳过这个站。</p> : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-agent-browser-wall-action="continue"
            onClick={() => answerBrowserWall(prompt.key, 'continue')}
          >
            <Icon icon={Check} size="sm" />
            继续
          </button>
          {agentBrowser ? (
            <button
              type="button"
              className={styles.secondary}
              data-agent-browser-wall-action="show"
              onClick={() => {
                setShowFailed(null)
                void agentBrowser
                  .show(prompt.siteId, `轻画 · ${prompt.label}：${what}`)
                  .catch(() => setShowFailed(prompt.key))
              }}
            >
              <Icon icon={ExternalLink} size="sm" />
              显示窗口
            </button>
          ) : null}
          <button
            type="button"
            className={styles.ghost}
            data-agent-browser-wall-action="cancel"
            onClick={() => answerBrowserWall(prompt.key, 'cancel')}
          >
            取消
          </button>
        </div>
      </div>
    </section>
  )
}
