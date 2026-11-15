import { errorTextOf } from '../../shared/result'
import { useEffect, useRef, useState } from 'react'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import type { WorkflowEntry } from '../../domain/project/workflowParams'
import { quickTestCategory, runChannelQuickTest } from '../../state/channel/channelQuickTest'
import { submittedTaskIdOf } from '../../platform/channels/runninghubWorkflowRun'
import { RH_MARKET_DEFAULT_HOST } from '../../platform/channels/runninghubMarket'
import { loadEntryKey, recheckWorkflowTask } from './workflowTaskRecheck'
import shell from './SettingsWorkflowEntries.module.css'
import styles from './SettingsChannelQuickTest.module.css'

/**
 * 条目设置页左下角的「测试运行」（用户给的参考图四 / 图五那一颗蓝色按钮）。
 *
 * 与渠道页的「快速测试」同一个执行器（`runChannelQuickTest`），差别只有两点：
 * - 模型固定成**这个条目**（`workflow:` / `app:`），不用用户再选；
 * - 参数用条目里**已暴露字段的默认值**拼成 `nodeInfoList`，也就是"用现在的配置跑一次"。
 *
 * 媒体字段刻意**不下发**：这里没有上游素材，塞空串在 RunningHub 等于「清空该参数」，
 * 不如让它走工作流自己的默认值。
 */
export function SettingsWorkflowTestRun({
  channel,
  entry,
  groupId,
  channels,
  platform,
}: {
  channel: Channel
  entry: WorkflowEntry
  groupId?: string
  channels: ChannelStore
  platform: PlatformKit
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  /** 已提交、但停止等待了的任务 id（超时 / 点停止）：凭它「再查一次」，不重新提交 */
  const [pendingTask, setPendingTask] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 卸载就停止等待（任务仍在上游，id 已在界面上说过） */
  useEffect(() => () => abortRef.current?.abort(), [])

  const loadKey = () => loadEntryKey(channels, channel.id, groupId)

  const recheck = async (taskId: string) => {
    setChecking(true)
    setError('')
    setResult('')
    try {
      const outcome = await recheckWorkflowTask(
        { network: platform.network },
        { host: channel.baseUrl || RH_MARKET_DEFAULT_HOST, apiKey: await loadKey() },
        taskId,
        AbortSignal.timeout(30_000),
      )
      if (outcome.kind === 'failed') setError(outcome.text)
      else setResult(outcome.text)
      if (outcome.kind !== 'pending') setPendingTask(null)
    } catch (e) {
      setError(errorTextOf(e))
    } finally {
      setChecking(false)
    }
  }

  const run = async () => {
    setRunning(true)
    setError('')
    setResult('')
    setPendingTask(null)
    const controller = new AbortController()
    abortRef.current = controller
    const timer = setTimeout(() => controller.abort(), 180_000)
    try {
      const apiKey = await loadKey()

      const workflow = entry.fields
        .filter((field) => field.enabled)
        .filter((field) => !['image', 'video', 'audio'].includes(field.type))
        .map((field) => ({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: field.value }))
      const category = quickTestCategory(entry.outputKind === 'video' ? 'video' : 'image') ?? 'image'
      const outcome = await runChannelQuickTest({
        platform,
        channel,
        catalog: channels.protocolCatalog(),
        apiKey,
        model: entry.kind === 'app' ? `app:${entry.id}` : `workflow:${entry.id}`,
        category,
        prompt: '',
        params: workflow.length > 0 ? { workflow } : {},
        signal: controller.signal,
      })
      setResult(
        outcome.kind === 'text'
          ? outcome.text.slice(0, 400)
          : `已返回 ${outcome.mime}${outcome.bytes ? ` · ${Math.round(outcome.bytes.length / 1024)} KB` : ''}`,
      )
    } catch (e) {
      setPendingTask(submittedTaskIdOf(e))
      setError(errorTextOf(e))
    } finally {
      clearTimeout(timer)
      abortRef.current = null
      setRunning(false)
    }
  }

  return (
    <div className={styles.testRun} data-workflow-test-run>
      <button
        type="button"
        className={shell.btnPrimary}
        disabled={running}
        onClick={() => void run()}
        data-workflow-test-run-button
      >
        {running ? '运行中…' : '测试运行'}
      </button>
      {running ? (
        <button type="button" className={shell.linkBtn} onClick={() => abortRef.current?.abort()} data-workflow-test-run-stop>
          停止等待（任务照常在上游跑）
        </button>
      ) : null}
      <p className={shell.muted}>会调用正式接口并计费；用条目里已暴露字段的当前值跑一次。</p>
      {result ? <p className={styles.result}>{result}</p> : null}
      {error ? (
        <p className={styles.error} data-workflow-test-run-error>
          {error}
        </p>
      ) : null}
      {pendingTask && !running ? (
        <div className={shell.actions} data-workflow-test-run-task={pendingTask}>
          <span className={shell.muted}>任务 id：{pendingTask}</span>
          <button type="button" className={shell.btn} disabled={checking} onClick={() => void recheck(pendingTask)} data-workflow-test-run-recheck>
            {checking ? '查询中…' : '再查一次'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
