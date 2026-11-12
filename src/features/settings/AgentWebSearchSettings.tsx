import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { normalizeSearxngEndpoint } from '../../domain/inspiration/designResearch'
import { TAVILY_API_KEY_REF } from '../../features/shared/research/tavilySearch'
import { createPresetStore } from '../../state/project/presetStore'
import styles from './AgentSettingsPanel.module.css'

/**
 * 联网调研设置（2026-11-11 重做）。
 *
 * - 默认免 Key 搜索（Bing 结果页，桌面壳原生请求）；Tavily API Key 改为可选备用，
 *   只在免费通道失败时使用。Key 走凭据端口（桌面壳为 Windows DPAPI），界面只显示“已保存”，不回显任何字符。
 * - SearXNG：可选的自建元搜索地址；留空即跳过（不再有公共默认实例）。
 * - 网页正文读取走 Jina Reader，不需要 Key；读不到时直接读取原网页。
 */
export function AgentWebSearchSettings() {
  const platform = usePlatform()
  const presets = useMemo(() => createPresetStore(platform.storage), [platform.storage])
  const [endpoint, setEndpoint] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void presets.loadAgentWebSearch()
      .then((settings) => {
        if (active) setEndpoint(settings.endpoint)
      })
      .catch(() => {
        if (active) setStatus('读取 SearXNG 设置失败')
      })
    void platform.credentials.load(TAVILY_API_KEY_REF)
      .then((saved) => {
        if (active) setHasKey(Boolean(saved && saved.trim()))
      })
      .catch(() => {
        if (active) setStatus('读取 Tavily Key 失败，请重新填写')
      })
    return () => {
      active = false
    }
  }, [presets, platform.credentials])

  const run = async (task: () => Promise<string>) => {
    setBusy(true)
    setStatus('')
    try {
      setStatus(await task())
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const saveKey = () =>
    run(async () => {
      const key = keyDraft.trim()
      if (!key) return '请先粘贴 Tavily API Key'
      await platform.credentials.save(TAVILY_API_KEY_REF, key)
      setKeyDraft('')
      setHasKey(true)
      return '已保存，下一次联网调研生效'
    })

  const removeKey = () =>
    run(async () => {
      await platform.credentials.remove(TAVILY_API_KEY_REF)
      setHasKey(false)
      return '已删除 Tavily Key'
    })

  const saveEndpoint = (value: string) =>
    run(async () => {
      const trimmed = value.trim()
      const normalized = normalizeSearxngEndpoint(trimmed)
      if (trimmed && !normalized) return '请输入以 http:// 或 https:// 开头的 SearXNG 地址'
      await presets.saveAgentWebSearch({ endpoint: normalized })
      setEndpoint(normalized)
      return normalized ? '已保存 SearXNG 地址' : '已清空，SearXNG 不再参与搜索'
    })

  return (
    <section className={styles.capability} data-agent-web-search>
      <div className={styles.capabilityHead}>
        <h4>联网调研</h4>
        <p>
          Agent 输入框里的「联网」打开时，免 Key 搜索固定设计站点的网页与图片，用 Jina Reader 读取网页正文（读不到时直接读取原网页）。
          搜到的图只作为对话里的候选，你选中后才会加入参考。
        </p>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Tavily API Key{hasKey ? '（可选，已保存）' : '（可选，未填写）'}
        </span>
        <input
          className={styles.textInput}
          type="password"
          value={keyDraft}
          placeholder={hasKey ? '已保存；粘贴新 Key 可替换' : '粘贴 tvly- 开头的 Key'}
          autoComplete="off"
          spellCheck={false}
          data-agent-tavily-key
          onChange={(event) => setKeyDraft(event.target.value)}
        />
      </label>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.inlineButton}
          disabled={busy || !keyDraft.trim()}
          data-agent-tavily-key-save
          onClick={() => void saveKey()}
        >
          {busy ? '保存中…' : '保存 Key'}
        </button>
        {hasKey ? (
          <button
            type="button"
            className={styles.inlineButton}
            disabled={busy}
            data-agent-tavily-key-remove
            onClick={() => void removeKey()}
          >
            删除 Key
          </button>
        ) : null}
      </div>
      <p className={styles.hint}>
        可选：免费搜索被验证码或限流拦住时才改用 Tavily。在 tavily.com 注册可获得免费 Key（每月 1000 次）。Key 只保存在本机，不会写进项目或日志。
      </p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>SearXNG 地址（可选）</span>
        <input
          className={styles.textInput}
          value={endpoint}
          placeholder="留空即不使用；可填自建实例的 /search 地址"
          spellCheck={false}
          data-agent-web-search-endpoint
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </label>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.inlineButton}
          disabled={busy}
          data-agent-web-search-save
          onClick={() => void saveEndpoint(endpoint)}
        >
          保存地址
        </button>
        <button
          type="button"
          className={styles.inlineButton}
          disabled={busy || !endpoint}
          onClick={() => void saveEndpoint('')}
        >
          清空
        </button>
      </div>
      {status ? <p className={styles.status} role="status">{status}</p> : null}
    </section>
  )
}
