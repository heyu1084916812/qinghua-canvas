import { useEffect, useMemo, useState } from 'react'
import type { Channel } from '../../domain/project/channel'
import type { PlatformKit } from '../../platform/ports'
import { createWorkflowEntryStore } from '../../state/channel/workflowEntryStore'
import styles from './SettingsWorkflowEntries.module.css'

/**
 * 渠道页上的「AI 应用和工作流」**入口**（#1131）。
 *
 * 条目管理已搬到独立页 `/workflows`（两个标签 + 国内 / 国际站切换 + 条目设置）；
 * 渠道页只留连接、Key 和这一条入口：一行计数 + 一个按钮。上一版把整页管理器塞进渠道表单，
 * 打开时要把侧栏、选路、模型列表全部藏掉，层级别扭、也容易卡在看不到管理器的整页态（审查 L12）。
 */
export type SettingsWorkflowManagerProps = {
  channel: Channel
  platform: PlatformKit
  onOpen: () => void
}

export function SettingsWorkflowManager({ channel, platform, onOpen }: SettingsWorkflowManagerProps) {
  const store = useMemo(() => createWorkflowEntryStore(platform.storage), [platform.storage])
  const [counts, setCounts] = useState<{ apps: number; workflows: number } | null>(null)
  useEffect(() => {
    let alive = true
    setCounts(null)
    void store
      .load(channel.id)
      .then((entries) => {
        if (alive) setCounts({ apps: entries.filter((e) => e.kind === 'app').length, workflows: entries.filter((e) => e.kind !== 'app').length })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [channel.id, store])

  return (
    <section className={styles.block} data-workflow-manager-entry>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>AI 应用和工作流</span>
          <span className={styles.sub}>
            {counts ? `已添加 ${counts.apps} 个应用 · ${counts.workflows} 条工作流` : '导入、参数暴露与测试运行在单独的管理页'}
          </span>
        </div>
        <button type="button" className={styles.btn} onClick={onOpen} data-workflow-manager-open>
          打开管理页
        </button>
      </div>
    </section>
  )
}
