import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  DEFAULT_SEARXNG_ENDPOINT,
  normalizeSearxngEndpoint,
} from '../../domain/inspiration/designResearch'
import { createPresetStore } from '../../state/project/presetStore'
import styles from './AgentSettingsPanel.module.css'

export function AgentWebSearchSettings() {
  const platform = usePlatform()
  const presets = useMemo(() => createPresetStore(platform.storage), [platform.storage])
  const [endpoint, setEndpoint] = useState(DEFAULT_SEARXNG_ENDPOINT)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void presets.loadAgentWebSearch()
      .then((settings) => {
        if (active) setEndpoint(settings.endpoint)
      })
      .catch(() => {
        if (active) setStatus('读取失败，当前使用默认开源搜索地址')
      })
    return () => {
      active = false
    }
  }, [presets])

  const save = async (value: string) => {
    const normalized = normalizeSearxngEndpoint(value)
    if (!normalized) {
      setStatus('请输入以 http:// 或 https:// 开头的 SearXNG 地址')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      await presets.saveAgentWebSearch({ endpoint: normalized })
      setEndpoint(normalized)
      setStatus('已保存，下一次联网调研生效')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.capability} data-agent-web-search>
      <div className={styles.capabilityHead}>
        <h4>联网调研</h4>
        <p>
          Openverse 与 Wikipedia 会直接检索图片和公开内容；SearXNG 是开源元搜索，
          用于补充普通网页结果。公共实例不可用时，其余来源仍会继续。
        </p>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>SearXNG 搜索地址</span>
        <input
          className={styles.textInput}
          value={endpoint}
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
          onClick={() => void save(endpoint)}
        >
          {busy ? '保存中…' : '保存搜索地址'}
        </button>
        <button
          type="button"
          className={styles.inlineButton}
          disabled={busy}
          onClick={() => void save(DEFAULT_SEARXNG_ENDPOINT)}
        >
          恢复默认
        </button>
      </div>
      <p className={styles.hint}>
        默认使用公共 SearXNG 实例；你也可以填写自己部署的 `/search` 地址。
      </p>
      {status ? <p className={styles.status} role="status">{status}</p> : null}
    </section>
  )
}
