import type { WorkflowEntry } from '../../domain/project/workflowParams'
import type { WorkflowsTab } from '../../domain/project/workflowsPage'
import type { RhMarketEntry } from '../../platform/channels/runninghubMarket'
import styles from './WorkflowsPage.module.css'

/**
 * 「AI 应用 / 工作流」页的卡片网格 + 市场列表（#1131）。
 *
 * 卡片：封面 / 名称 / 备注（没有备注就写路由 id）/ 参数计数；点卡片进条目设置，
 * 右上角「删除」。名称与备注不在卡片上就地改了——逐键写库会和导入抢同一行，
 * 改名统一去条目设置页（那里有完整的名称 / 备注 / 输出类型 / 测试运行）。
 */
export function WorkflowEntryGrid({
  tab,
  entries,
  ready,
  market,
  busy,
  onCloseMarket,
  onAddFromMarket,
  onOpen,
  onRemove,
}: {
  tab: WorkflowsTab
  entries: readonly WorkflowEntry[]
  ready: boolean
  market: RhMarketEntry[] | null
  busy: boolean
  onCloseMarket: () => void
  onAddFromMarket: (item: RhMarketEntry) => void
  onOpen: (entry: WorkflowEntry) => void
  onRemove: (entry: WorkflowEntry) => void
}) {
  const label = tab === 'app' ? 'AI 应用' : '工作流'
  return (
    <div className={styles.body}>
      {market ? (
        <section className={styles.market} data-workflows-market>
          <div className={styles.marketHead}>
            <span className={styles.marketTitle}>市场 · 工作流（只扣运行时长）</span>
            <button type="button" className={styles.link} onClick={onCloseMarket}>
              收起
            </button>
          </div>
          {market.length === 0 ? <p className={styles.muted}>正在读取市场…</p> : null}
          <ul className={styles.marketList}>
            {market.map((item) => (
              <li key={item.skuId} className={styles.marketItem}>
                <span className={styles.marketName}>{item.title}</span>
                <span className={styles.muted}>{item.categoryName} · 运行时长费用</span>
                <button type="button" className={styles.ghost} disabled={busy} onClick={() => onAddFromMarket(item)}>
                  导入
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!ready ? <p className={styles.empty}>正在读取{label}…</p> : null}
      {ready && entries.length === 0 ? (
        <p className={styles.empty} data-workflows-empty>
          还没有{label}。把 RunningHub 上的{tab === 'app' ? '应用详情页' : '工作流'}链接粘到上面，点「导入」。
        </p>
      ) : null}

      <ul className={styles.cards} data-workflows-cards={tab}>
        {entries.map((entry) => {
          const exposed = entry.fields.filter((field) => field.enabled).length
          return (
            <li key={`${entry.kind ?? 'workflow'}:${entry.id}`} className={styles.cardItem}>
              <button
                type="button"
                className={styles.card}
                onClick={() => onOpen(entry)}
                data-workflows-card={entry.id}
                aria-label={`${entry.title}：打开设置`}
              >
                <span className={styles.cardShot}>
                  {entry.coverUrl ? (
                    <img className={styles.cardShotImg} src={entry.coverUrl} alt="" />
                  ) : (
                    <span className={styles.cardShotEmpty}>{label}</span>
                  )}
                </span>
                <span className={styles.cardBody}>
                  <span className={styles.cardName}>{entry.title}</span>
                  {entry.note?.trim() ? (
                    <span className={styles.cardDesc}>{entry.note.trim()}</span>
                  ) : (
                    <span className={styles.cardRoute}>
                      {entry.kind === 'app' ? '/run/ai-app/' : '/run/workflow/'}
                      {entry.id}
                    </span>
                  )}
                  <span className={styles.cardMeta}>
                    {entry.fields.length} 个参数 · 已暴露 {exposed}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={styles.cardRemove}
                disabled={busy}
                onClick={() => onRemove(entry)}
                data-workflows-card-remove={entry.id}
              >
                删除
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
