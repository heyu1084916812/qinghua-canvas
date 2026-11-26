import type { ConversationResearchStatus } from './agentResearchConversation'
import styles from './ResearchStatusPanel.module.css'

const STATUS_TEXT: Record<string, string> = {
  ok: '有结果',
  empty: '没有命中',
  'needs-login': '需要登录',
  'needs-browser': '需要内置浏览器',
  blocked: '被验证码或站点策略挡住',
  timeout: '超时',
  error: '读取失败',
}

export function ResearchStatusPanel({
  status,
}: {
  status: ConversationResearchStatus
}) {
  const belowTarget = status.target > 0 && status.actual < status.target
  return (
    <div className={styles.panel} data-agent-research-status>
      <div className={styles.head}>
        <strong>
          {status.target > 0
            ? `目标 ${status.target} 张 · 实收 ${status.actual} 张`
            : `实收 ${status.actual} 张`}
        </strong>
        {belowTarget ? <span>数量不足，下面列出各站原因</span> : null}
      </div>
      {status.queries.length > 0 ? (
        <div className={styles.queries} aria-label="本次检索词">
          {status.queries.map((query) => (
            <span key={query} className={styles.query}>{query}</span>
          ))}
        </div>
      ) : null}
      {status.siteStatuses.length > 0 ? (
        <div className={styles.sites}>
          {status.siteStatuses.map((row) => (
            <div
              key={`${row.site}:${row.status}`}
              className={styles.site}
              data-agent-research-site-status={row.status}
            >
              <span className={styles.siteName}>{row.site}</span>
              <span className={styles.siteCount}>{row.itemCount} 张</span>
              <span className={styles.siteReason}>
                {row.note || STATUS_TEXT[row.status] || row.status}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
