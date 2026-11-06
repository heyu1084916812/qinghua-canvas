import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type {
  PinterestBoard,
  PinterestPin,
} from '../../../domain/inspiration/pinterest'
import {
  pinterestOAuthUrl,
  pinterestPinToResearchItem,
} from '../../../domain/inspiration/pinterest'
import { activeCanvasId } from '../../../state/project/activeCanvas'
import {
  clearPinterestConnection,
  clearPinterestSession,
  loadPinterestConnection,
  savePinterestApp,
  savePinterestSession,
  type PinterestConnection,
} from '../../../state/project/pinterestConnectionStore'
import { saveDesignResearchItem } from '../research/saveResearchItem'
import { sendAssetToActiveCanvas } from '../../assets/sendToActiveCanvas'
import { createId } from '../../../shared/id'
import { createPinterestApi } from './pinterestApi'
import { openPinterestSession } from './pinterestSession'
import {
  isPinterestLoopbackRedirect,
  parsePinterestCallbackInput,
  type PinterestOAuthCallback,
} from './pinterestOAuth'
import { PinterestSetupView } from './PinterestSetupView'
import { PinterestImportView } from './PinterestImportView'
import styles from './PinterestPanel.module.css'

export function PinterestPanel({ onClose }: { onClose: () => void }) {
  const platform = usePlatform()
  const [connection, setConnection] = useState<PinterestConnection | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(
    'http://127.0.0.1:53682/pinterest/callback',
  )
  const [manualCallback, setManualCallback] = useState('')
  const [oauthState, setOauthState] = useState('')
  const [boards, setBoards] = useState<PinterestBoard[]>([])
  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(new Set())
  const [pins, setPins] = useState<PinterestPin[]>([])
  const [selectedPins, setSelectedPins] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const activeOauthStateRef = useRef('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const canvasReady = Boolean(activeCanvasId())

  const refresh = useCallback(async () => {
    const next = await loadPinterestConnection(platform.storage, platform.credentials)
    setConnection(next)
    if (next) {
      setClientId(next.clientId)
      setRedirectUri(next.redirectUri)
    }
  }, [platform])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      controllerRef.current?.abort()
      const state = activeOauthStateRef.current
      if (state && isTauri()) {
        void invoke('pinterest_oauth_cancel', { state }).catch(() => undefined)
      }
    }
  }, [onClose])

  const newController = () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  }

  const saveApp = async () => {
    if (busy) return
    setBusy('save')
    setStatus('')
    try {
      const next = await savePinterestApp(platform.storage, platform.credentials, {
        clientId,
        clientSecret,
        redirectUri,
      })
      setConnection(next)
      setClientSecret('')
      setStatus('Pinterest OAuth 应用配置已加密保存在本机。')
    } catch (error) {
      setStatus(`保存失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const exchangeCode = async (code: string) => {
    const stored = await loadPinterestConnection(platform.storage, platform.credentials)
    if (!stored?.hasClientSecret) throw new Error('请先保存 Client Secret')
    const secret = await platform.credentials.load('oauth:pinterest:client-secret')
    if (!secret) throw new Error('Client Secret 已丢失，请重新填写')
    const controller = newController()
    const api = createPinterestApi(platform.network)
    const token = await api.exchangeCode(
      {
        clientId: stored.clientId,
        clientSecret: secret,
        redirectUri: stored.redirectUri,
        code,
      },
      controller.signal,
    )
    const user = await api.user(token.accessToken, controller.signal)
    const next = await savePinterestSession(platform.storage, platform.credentials, {
      token,
      user,
    })
    setConnection(next)
    setStatus(`已连接 Pinterest 账号 @${user.username}`)
  }

  const authorize = async () => {
    if (busy) return
    setBusy('authorize')
    const state = createId('pinterest_oauth')
    activeOauthStateRef.current = state
    setOauthState(state)
    setStatus('正在准备 Pinterest 授权…')
    let listening = false
    let callbackUri = redirectUri.trim()
    try {
      if (isTauri() && isPinterestLoopbackRedirect(callbackUri)) {
        try {
          callbackUri = await invoke<string>('pinterest_oauth_listen', { state })
          listening = true
          setRedirectUri(callbackUri)
        } catch {
          setStatus('自动回调未启动；授权完成后可手动粘贴回调地址。')
        }
      }
      await savePinterestApp(platform.storage, platform.credentials, {
        clientId,
        clientSecret,
        redirectUri: callbackUri,
      })
      const oauthUrl = pinterestOAuthUrl({
        clientId: clientId.trim(),
        redirectUri: callbackUri,
        state,
      })
      if (!isTauri()) {
        const opened = window.open(oauthUrl, '_blank', 'noopener,noreferrer')
        if (!opened) throw new Error('浏览器阻止了 Pinterest 授权窗口')
        setStatus('完成授权后，复制浏览器地址栏的完整回调地址并粘贴到下方。')
        return
      }
      await openUrl(oauthUrl)
      if (!listening) {
        setStatus('完成授权后，复制浏览器地址栏的完整回调地址并粘贴到下方。')
        return
      }
      setStatus('等待 Pinterest 授权完成…')
      const callback = await invoke<PinterestOAuthCallback>('pinterest_oauth_wait', {
        state,
        timeoutMs: 180_000,
      })
      await exchangeCode(callback.code)
      await refresh()
    } catch (error) {
      if (listening) {
        await invoke('pinterest_oauth_cancel', { state }).catch(() => undefined)
      }
      setStatus(`授权未完成：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const submitManualCallback = async () => {
    if (busy) return
    setBusy('manual-callback')
    setStatus('')
    try {
      const callback = parsePinterestCallbackInput(manualCallback, oauthState)
      await savePinterestApp(platform.storage, platform.credentials, {
        clientId,
        clientSecret,
        redirectUri,
      })
      await exchangeCode(callback.code)
      setManualCallback('')
    } catch (error) {
      setStatus(`回调处理失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const loadBoards = async () => {
    if (busy) return
    setBusy('boards')
    setStatus('正在读取 Pinterest 收藏板…')
    try {
      const controller = newController()
      const session = await openPinterestSession(platform, controller.signal)
      const next = await session.api.boards(session.accessToken, controller.signal)
      setConnection(session.connection)
      setBoards(next)
      setSelectedBoards(new Set(next.map((board) => board.id)))
      setPins([])
      setSelectedPins(new Set())
      setStatus(`读取到 ${next.length} 个收藏板。`)
    } catch (error) {
      setStatus(`读取收藏板失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const loadPins = async () => {
    if (busy) return
    if (selectedBoards.size === 0) {
      setStatus('先选择至少一个 Pinterest 收藏板。')
      return
    }
    setBusy('pins')
    setStatus('正在读取收藏图片…')
    try {
      const controller = newController()
      const session = await openPinterestSession(platform, controller.signal)
      const batches = await Promise.all(
        boards
          .filter((board) => selectedBoards.has(board.id))
          .map((board) => session.api.pins(session.accessToken, board.id, controller.signal)),
      )
      const next = batches.flat()
      setConnection(session.connection)
      setPins(next)
      setSelectedPins(new Set(next.filter((pin) => pin.imageUrl).map((pin) => pin.id)))
      setStatus(`读取到 ${next.length} 张收藏图片。`)
    } catch (error) {
      setStatus(`读取收藏图片失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const importSelected = async (toCanvas: boolean) => {
    if (busy) return
    const targets = pins.filter((pin) => selectedPins.has(pin.id) && pin.imageUrl)
    if (targets.length === 0) {
      setStatus('先选择要导入的 Pinterest 图片。')
      return
    }
    if (toCanvas && !canvasReady) {
      setStatus('先打开一个画布项目，再导入。')
      return
    }
    setBusy(toCanvas ? 'import-canvas' : 'import-library')
    let imported = 0
    try {
      const controller = newController()
      for (const pin of targets) {
        const board = boards.find((item) => item.id === pin.boardId)
        if (!board) continue
        const item = pinterestPinToResearchItem(pin, board)
        if (!item) continue
        const saved = await saveDesignResearchItem(
          item,
          { network: platform.network, storage: platform.storage },
          controller.signal,
        )
        if (!saved.ok || !saved.asset) throw new Error(saved.message)
        if (toCanvas) await sendAssetToActiveCanvas(platform, saved.asset)
        imported += 1
        setStatus(`正在导入 ${imported}/${targets.length}…`)
      }
      setStatus(
        toCanvas
          ? `已导入 ${imported} 张到当前画布。`
          : `已保存 ${imported} 张到素材库。`,
      )
    } catch (error) {
      setStatus(`导入中断：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const disconnect = async () => {
    if (busy) return
    setBusy('disconnect')
    setStatus('')
    try {
      await clearPinterestSession(platform.storage, platform.credentials)
      await refresh()
      setBoards([])
      setPins([])
      setStatus('已断开 Pinterest 账号，OAuth 应用配置仍保留。')
    } catch (error) {
      setStatus(`断开失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const forget = async () => {
    if (busy) return
    setBusy('forget')
    setStatus('')
    try {
      await clearPinterestConnection(platform.storage, platform.credentials)
      activeOauthStateRef.current = ''
      setOauthState('')
      setConnection(null)
      setClientId('')
      setClientSecret('')
      setBoards([])
      setPins([])
      setStatus('已清除 Pinterest 应用配置和本机令牌。')
    } catch (error) {
      setStatus(`清除失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const selectedPinCount = useMemo(
    () => pins.filter((pin) => selectedPins.has(pin.id) && pin.imageUrl).length,
    [pins, selectedPins],
  )
  const connected = Boolean(connection?.hasAccessToken && connection.user)

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="Pinterest 收藏">
      <section className={styles.panel} data-pinterest-panel>
        <header className={styles.head}>
          <div>
            <h2>Pinterest 收藏</h2>
            <p>登录你自己的 Pinterest，读取收藏板图片，再保存到素材库或导入当前画布。</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        {!connected ? (
          <PinterestSetupView
            busy={busy}
            connection={connection}
            clientId={clientId}
            clientSecret={clientSecret}
            redirectUri={redirectUri}
            manualCallback={manualCallback}
            onClientId={setClientId}
            onClientSecret={setClientSecret}
            onRedirectUri={setRedirectUri}
            onManualCallback={setManualCallback}
            onSave={() => void saveApp()}
            onAuthorize={() => void authorize()}
            onManualSubmit={() => void submitManualCallback()}
          />
        ) : (
          <div className={styles.account}>
            <div>
              <strong>@{connection?.user?.username}</strong>
              <span>Pinterest 账号已连接</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void disconnect()}>
                断开账号
              </button>
              <button type="button" className={styles.danger} onClick={() => void forget()}>
                清除配置
              </button>
            </div>
          </div>
        )}

        {connected ? (
          <PinterestImportView
            busy={busy}
            boards={boards}
            selectedBoards={selectedBoards}
            pins={pins}
            selectedPins={selectedPins}
            selectedPinCount={selectedPinCount}
            canvasReady={canvasReady}
            onBoards={setSelectedBoards}
            onPins={setSelectedPins}
            onLoadBoards={() => void loadBoards()}
            onLoadPins={() => void loadPins()}
            onImportLibrary={() => void importSelected(false)}
            onImportCanvas={() => void importSelected(true)}
          />
        ) : null}

        {status ? (
          <p className={styles.status} role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
      </section>
    </div>
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
