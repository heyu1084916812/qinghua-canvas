import { invoke, isTauri } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import styles from './CanvasMcpPanel.module.css'

interface CanvasGatewayInfo {
  url: string
  token: string
  mcpCommand: string
  mcpConfig: unknown
}

interface CapabilityResponse {
  ok?: boolean
  result?: {
    tools?: unknown[]
    denied?: string[]
  }
}

function mcpConfigText(config: unknown): string {
  return JSON.stringify(config, null, 2) ?? '{}'
}

export function CanvasMcpPanel() {
  const desktop = isTauri()
  const [info, setInfo] = useState<CanvasGatewayInfo | null>(null)
  const [status, setStatus] = useState('')
  const [tools, setTools] = useState<number | null>(null)
  const [denied, setDenied] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!desktop) {
      setStatus('Canvas MCP 仅桌面应用可用。')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const next = await invoke<CanvasGatewayInfo>('canvas_gateway_info')
      setInfo(next)
      setStatus('Canvas 网关已启动')
    } catch (error) {
      setInfo(null)
      setStatus(`Canvas 网关未启动：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [desktop])

  useEffect(() => {
    void load()
  }, [load])

  const verify = async () => {
    if (!info) return
    setBusy(true)
    setStatus('正在验证 MCP 网关…')
    try {
      const response = await fetch(`${info.url}/capabilities`, {
        headers: { authorization: `Bearer ${info.token}` },
      })
      const body = (await response.json()) as CapabilityResponse
      if (!response.ok || body.ok === false) {
        throw new Error(`HTTP ${response.status}`)
      }
      const list = Array.isArray(body.result?.tools) ? body.result.tools : []
      setTools(list.length)
      setDenied(
        Array.isArray(body.result?.denied)
          ? body.result.denied.filter((item): item is string => typeof item === 'string')
          : [],
      )
      setStatus(`验证通过：${list.length} 个外部工具可调用`)
    } catch (error) {
      setTools(null)
      setDenied([])
      setStatus(`验证失败：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('已复制 MCP 配置')
    } catch {
      setStatus('复制失败，请手动选择文本')
    }
  }

  return (
    <div className={styles.panel} data-canvas-mcp-panel>
      <div className={styles.head}>
        <div>
          <h4>Canvas MCP</h4>
          <p>供 Codex、Claude Code、Cursor 或其他支持 MCP stdio 的 harness 连接当前画布。</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} disabled={busy} onClick={() => void load()}>
            重新读取
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            data-canvas-mcp-verify
            disabled={busy || !info}
            onClick={() => void verify()}
          >
            验证连接
          </button>
        </div>
      </div>

      {!desktop ? (
        <p className={styles.note}>浏览器开发版不能启动本机 stdio MCP；请在桌面版中配置。</p>
      ) : info ? (
        <>
          <div className={styles.facts}>
            <span>地址</span>
            <code>{info.url}</code>
            <span>已暴露</span>
            <strong>{tools === null ? '尚未验证' : `${tools} 个工具`}</strong>
            <span>受保护操作</span>
            <strong>{denied.length ? denied.join(' · ') : '验证后显示'}</strong>
          </div>
          <div className={styles.codeBlock}>
            <div className={styles.codeHead}>
              <span>MCP 配置</span>
              <button
                type="button"
                className={styles.linkBtn}
                data-canvas-mcp-copy
                onClick={() => void copy(mcpConfigText(info.mcpConfig))}
              >
                复制配置
              </button>
            </div>
            <pre>{mcpConfigText(info.mcpConfig)}</pre>
          </div>
          <p className={styles.note}>
            配置只调用随应用打包的 PowerShell 适配器；读取 Token 由适配器从本机网关配置完成，不写进 harness 配置。
            画布必须处于打开状态；删除、改节点、付费生成和记忆写入不会开放给外部 MCP。
          </p>
        </>
      ) : null}

      {status ? (
        <p className={styles.status} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  )
}
